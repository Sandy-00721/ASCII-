/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  Send, 
  Settings, 
  Cpu, 
  MessageSquare, 
  Trash2, 
  Check, 
  AlertCircle, 
  ExternalLink,
  Code2,
  Share2,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Maximize
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import mermaid from 'mermaid';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Utility for Tailwind class merging */
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  id: string;
  timestamp: Date;
}

interface ParsedContent {
  ascii: string | null;
  mermaid: string | null;
  analysis: string | null;
  raw: string;
}

// --- Constants ---

const DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
const SYSTEM_PROMPT = `你是一个专业的工程技术专家及可视化助手。你的目标是帮助用户理解复杂的技术原理。

### 核心准则 (强制执行) ###
1. **ASCII 绝对优先**：只要涉及任何结构、原理、流程或系统，你**必须无条件**且**首先**输出 <ascii_diagram>。这是最直观的物理参考，不可省略。
2. **拓扑渲染图 (Mermaid) 为辅**：在 <hidden_mermaid> 中输出逻辑流向图。用户可以通过界面按钮展开查看。
3. **矩形黄金比例 (16:9)**：渲染图必须保持矩形，严禁生成极高的“单链条”图。通过 \`subgraph\` 使模块横向或矩阵式并列。
4. **多样化节点形状 (科研感)**：
   - \`(( ))\` 圆形：核心点、源头。
   - \`([ ])\` 体育场：运行过程。
   - \`{{ }}\` 六边形：外部系统、属性。
   - \`[[ ]]\` 子程序：详细模块。
   - \`{ }\` 菱形：判断环节。
   - \`classDef\`：必须应用配色方案（blue, green, orange, red, purple）。

5. **Mermaid 语法极高标准 (避免渲染崩溃)**：
   - **ID 必须包含字母**：节点的 ID 严禁全数字（例如 \`1 --> 2\` 是错的，必须用 \`n1 --> n2\`）。
   - **文本转义**：节点文本若含标点符号（含空格、()、[]、-、"等），**必须**将整体用双引号包裹，如 \`n1("包含(符号)的文本")\`。
   - **换行处理**：如果节点文字需换行，请使用 \`<br/>\`，禁止直接输入回车换行。
   - **连线简单**：使用标准的 \`-->\`，如果要带文字用 \`-->|文字|\`。
   - **不允许嵌套**：尽量避免 Subgraph 内再深度嵌套多层 Subgraph。

### 严格结构标签 ###

<ascii_diagram>
[此处输出精密、等宽的 ASCII 物理结构图。体现“零件感”。]
</ascii_diagram>
<hidden_mermaid>
%% 布局准则：LR 结合多并行 Subgraph。
flowchart LR
    %% 必须让不同模块水平并列，控制垂直高度。
</hidden_mermaid>
<text_analysis>
[文字解析：逻辑必须与 ASCII、Mermaid 保持 100% 同步。]
</text_analysis>

### 交付标准 ###
- **比例平衡**：优先横向铺开，确保重心稳定在中央。
- **一致性**：图表间的组件术语必须完全统一。
- **专业度**：使用不同形状区分组件功能，产出具备科研绘图质感的图表。`;


// --- Components ---

/** Shared Interactive Canvas Wrapper */
const InteractiveCanvas = ({ 
  children, 
  id, 
  title, 
  onExportPng, 
  onExportSvg,
  isExporting = false,
  theme = "light",
  defaultCollapsed = false,
  canToggle = true
}: { 
  children: React.ReactNode; 
  id: string;
  title: string;
  onExportPng?: () => void;
  onExportSvg?: () => void;
  isExporting?: boolean;
  theme?: "light" | "dark";
  defaultCollapsed?: boolean;
  canToggle?: boolean;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  // 确保内容的展示逻辑更稳健
  const autoFit = useCallback(() => {
    if (!containerRef.current || !contentRef.current || isCollapsed) return;
    
    const target = contentRef.current.querySelector('svg') || contentRef.current.querySelector('pre');
    if (!target) return;

    const containerSize = containerRef.current.getBoundingClientRect();
    let contentWidth, contentHeight;
    
    if (target.tagName.toLowerCase() === 'svg') {
       const bbox = (target as any).getBBox();
       contentWidth = bbox.width;
       contentHeight = bbox.height;
    } else {
       contentWidth = target.scrollWidth;
       contentHeight = target.scrollHeight;
    }

    const padding = 100;
    const availableWidth = containerSize.width - padding;
    const availableHeight = containerSize.height - padding;
    
    const scaleX = availableWidth / contentWidth;
    const scaleY = availableHeight / contentHeight;
    
    const newZoom = Math.min(scaleX, scaleY, 1.0);
    setZoom(Number(newZoom.toFixed(2)));
    setPosition({ x: 0, y: 0 }); 
  }, [id, isCollapsed]);

  useEffect(() => {
    if (!isCollapsed) {
      const timer = setTimeout(autoFit, 400);
      return () => clearTimeout(timer);
    }
  }, [id, autoFit, isCollapsed]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input')) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(z => Math.min(5, Math.max(0.1, z + delta)));
    }
  };

  return (
    <div className="relative group space-y-3">
      <div className="flex justify-between items-center px-1 h-8">
        <div className="flex items-center gap-4">
          <div 
            className={cn(
              "flex items-center gap-2 select-none",
              canToggle ? "cursor-pointer" : "cursor-default"
            )} 
            onClick={() => canToggle && setIsCollapsed(!isCollapsed)}
          >
            <div className={cn("w-2 h-2 rounded-full animate-pulse", theme === 'dark' ? 'bg-emerald-500' : 'bg-indigo-500')} />
            <span className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em]">{title}</span>
            {canToggle && (
              <div className="text-slate-300 hover:text-slate-500 transition-colors">
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </div>
            )}
          </div>
          
          {!isCollapsed && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-300">
              <div className={cn(
                "flex items-center border rounded-xl overflow-hidden shadow-sm scale-90",
                theme === 'dark' ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"
              )}>
                <button 
                  onClick={() => setZoom(z => Math.max(0.1, z - 0.1))} 
                  className={cn(
                    "p-1 px-3 border-r font-bold transition-colors",
                    theme === 'dark' ? "hover:bg-slate-800 border-slate-700 text-slate-400" : "hover:bg-slate-50 border-slate-100 text-slate-400"
                  )}
                >
                  -
                </button>
                <div className={cn("relative flex items-center px-2", theme === 'dark' ? 'bg-black/20' : 'bg-slate-50/50')}>
                  <input
                    type="number"
                    value={Math.round(zoom * 100)}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      if (!isNaN(val)) setZoom(val / 100);
                    }}
                    className={cn(
                      "w-16 text-center text-[10px] font-black bg-transparent border-none outline-none focus:ring-0",
                      theme === 'dark' ? 'text-emerald-400' : 'text-indigo-600'
                    )}
                  />
                  <span className={cn(
                    "text-[10px] font-black ml-[-4px] pointer-events-none",
                    theme === 'dark' ? 'text-emerald-900' : 'text-indigo-300'
                  )}>%</span>
                </div>
                <button 
                  onClick={() => setZoom(z => Math.min(5, z + 0.1))} 
                  className={cn(
                    "p-1 px-3 font-bold transition-colors",
                    theme === 'dark' ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-50 text-slate-400"
                  )}
                >
                  +
                </button>
              </div>
              <button 
                onClick={autoFit}
                className={cn(
                  "p-1.5 border rounded-lg transition-colors shadow-sm",
                  theme === 'dark' ? "bg-slate-900 border-slate-700 hover:bg-slate-800 text-slate-400" : "bg-white border-slate-200 hover:bg-slate-50 text-slate-400"
                )}
                title="Auto Fit"
              >
                <Maximize size={12} />
              </button>
              <button 
                onClick={() => { setZoom(1); setPosition({ x: 0, y: 0 }); }}
                className={cn(
                  "p-1.5 border rounded-lg transition-colors shadow-sm",
                  theme === 'dark' ? "bg-slate-900 border-slate-700 hover:bg-slate-800 text-slate-400" : "bg-white border-slate-200 hover:bg-slate-50 text-slate-400"
                )}
                title="Reset Scale"
              >
                <RefreshCw size={12} />
              </button>
            </div>
          )}
        </div>
        
        {!isCollapsed && (
          <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-300">
            {onExportPng && (
              <button
                onClick={onExportPng}
                disabled={isExporting}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all shadow-md active:scale-95",
                  isExporting ? "opacity-70 cursor-not-allowed" : "hover:shadow-lg",
                  theme === 'dark' ? "bg-emerald-600 hover:bg-emerald-500" : "bg-indigo-600 hover:bg-indigo-700"
                )}
              >
                <ExternalLink size={12} />
                {isExporting ? "PNG..." : "PNG"}
              </button>
            )}
            {onExportSvg && (
              <button
                onClick={onExportSvg}
                disabled={isExporting}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border shadow-sm active:scale-95",
                  theme === 'dark' 
                    ? "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800" 
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                )}
              >
                <Share2 size={12} />
                SVG
              </button>
            )}
          </div>
        )}
      </div>
      
      <div 
        ref={containerRef}
        className={cn(
          "relative group overflow-hidden rounded-[2rem] border transition-all duration-500 ease-in-out cursor-grab active:cursor-grabbing w-full shadow-2xl",
          theme === 'dark' 
            ? "bg-black border-slate-800 shadow-indigo-900/5 text-slate-300"
            : "bg-white border-slate-200 shadow-indigo-100/20 text-slate-900",
          isCollapsed ? "h-0 min-h-0 border-none opacity-0 invisible" : "min-h-[500px] opacity-100 visible h-[500px]"
        )}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div className={cn(
          "absolute inset-0 [background-size:40px_40px] pointer-events-none",
          theme === 'dark'
            ? "bg-[radial-gradient(#334155_1.5px,transparent_1.5px)] opacity-50"
            : "bg-[radial-gradient(#e2e8f0_1.5px,transparent_1.5px)] opacity-100"
        )} />
        
        <div className={cn(
          "absolute top-4 left-6 z-10 px-3 py-1.5 backdrop-blur-sm rounded-lg text-[8px] font-bold uppercase tracking-widest pointer-events-none border",
          theme === 'dark'
            ? "bg-slate-900/40 border-slate-700/50 text-slate-400"
            : "bg-slate-900/5 border-slate-200/50 text-slate-400"
        )}>
          交互：双指缩放 / 鼠标拖拽
        </div>

        <div 
          style={{ 
            transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
          className="relative w-full h-full min-h-[500px] flex justify-center items-center transition-transform duration-75 select-none"
        >
          <div ref={contentRef} className="flex justify-center items-center">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

/** Mermaid Diagram Renderer - 专业工程演示版 (支持 PPT 级兼容导出) */
const MermaidRenderer = ({ chart, id, isVisible }: { chart: string; id: string; isVisible: boolean }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const handleExportPng = () => {
    if (!containerRef.current) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;

    setIsExporting(true);
    try {
      const clonedSvg = svg.cloneNode(true) as SVGSVGElement;
      
      // 1. 深度清理与样式固化
      clonedSvg.querySelectorAll('*').forEach((el: any) => {
        el.style.display = '';
        el.style.visibility = '';
        // 关键修复：防止 Canvas 里的文字发生自动换行或溢出
        if (el.tagName === 'text' || el.tagName === 'tspan') {
          el.setAttribute('xml:space', 'preserve');
          el.style.whiteSpace = 'pre';
        }
      });

      const bbox = svg.getBBox();
      // PNG 导出使用更稳健的计算，增加边缘余量
      const safePadding = 120; 
      const exportWidth = bbox.width + safePadding * 2;
      const exportHeight = bbox.height + safePadding * 2;

      clonedSvg.setAttribute("width", (exportWidth * 2).toString()); // 导出分辨率加倍
      clonedSvg.setAttribute("height", (exportHeight * 2).toString());
      clonedSvg.setAttribute("viewBox", `${bbox.x - safePadding} ${bbox.y - safePadding} ${exportWidth} ${exportHeight}`);
      
      const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bgRect.setAttribute("x", (bbox.x - safePadding).toString());
      bgRect.setAttribute("y", (bbox.y - safePadding).toString());
      bgRect.setAttribute("width", exportWidth.toString());
      bgRect.setAttribute("height", exportHeight.toString());
      bgRect.setAttribute("fill", "none"); // 透明底色
      clonedSvg.insertBefore(bgRect, clonedSvg.firstChild);

      // 强制内联文字样式，确保 Canvas 渲染不丢失字体
      clonedSvg.querySelectorAll('text, tspan').forEach((t: any) => {
        t.setAttribute('fill', '#1e1b4b');
        t.setAttribute('font-family', 'Arial, sans-serif');
        t.setAttribute('font-size', '16px');
        t.setAttribute('font-weight', 'bold');
        t.style.fill = '#1e1b4b';
        t.style.fontFamily = 'Arial, sans-serif';
        t.style.fontWeight = 'bold';
      });

      const svgData = new XMLSerializer().serializeToString(clonedSvg);
      const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
      const reader = new FileReader();
      
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const scale = 2; // 高清倍率
          canvas.width = exportWidth * scale;
          canvas.height = exportHeight * scale;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          
          // 移除 ctx.fillStyle = '#ffffff' 和 ctx.fillRect
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          
          const pngUrl = canvas.toDataURL('image/png');
          const link = document.createElement("a");
          link.href = pngUrl;
          link.download = `Architecture_Final_${id.slice(0, 8)}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setIsExporting(false);
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(svgBlob);
    } catch (err) {
      console.error("PNG export failed:", err);
      setIsExporting(false);
    }
  };

  const handleExportSvg = () => {
    if (!containerRef.current) return;
    const svg = containerRef.current.querySelector('svg');
    if (!svg) return;

    try {
      const clonedSvg = svg.cloneNode(true) as SVGSVGElement;
      const bbox = svg.getBBox();
      const padding = 40;
      const exportWidth = bbox.width + padding * 2;
      const exportHeight = bbox.height + padding * 2;

      clonedSvg.setAttribute("width", exportWidth.toString());
      clonedSvg.setAttribute("height", exportHeight.toString());
      clonedSvg.setAttribute("viewBox", `${bbox.x - padding} ${bbox.y - padding} ${exportWidth} ${exportHeight}`);
      
      // 暴力内联：既然 PPT 不认 CSS，我们就手动把 CSS 解析后的颜色填进每个元素的 fill/stroke 属性
      clonedSvg.querySelectorAll('*').forEach((el: any) => {
        const styles = window.getComputedStyle(el);
        if (styles.fill !== 'none') el.setAttribute('fill', styles.fill);
        if (styles.stroke !== 'none') el.setAttribute('stroke', styles.stroke);
        if (el.tagName === 'text') {
          el.setAttribute('font-family', 'Arial');
          el.setAttribute('font-size', '14');
        }
      });

      const svgData = new XMLSerializer().serializeToString(clonedSvg);
      const finalSvg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${svgData}`;
      const blob = new Blob([finalSvg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Architecture_PPT_Safe_${id.slice(0, 8)}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("SVG export failed:", err);
    }
  };

  useEffect(() => {
    let isMounted = true;
    
    const renderChart = async () => {
      if (!containerRef.current || !chart) return;
      
      try {
        setError(null);
        // 超强预处理：移除一切可能干扰解析的噪音
        let cleanChart = chart
          .replace(/```mermaid/gi, "")
          .replace(/```/g, "")
          .replace(/^mermaid/i, "")
          .trim();

        // 补救措施 1: 确保有 flowchart 声明
        if (!cleanChart.startsWith('flowchart') && !cleanChart.startsWith('graph')) {
          cleanChart = `flowchart LR\n${cleanChart}`;
        }

        // 补救措施 2: 简单的 subgraph/end 平衡检查
        const subgraphCount = (cleanChart.match(/subgraph\s+/g) || []).length;
        const endCount = (cleanChart.match(/\bend\b/g) || []).length;
        if (subgraphCount > endCount) {
          cleanChart += "\n" + "end\n".repeat(subgraphCount - endCount);
        }

        if (!cleanChart) return;

        mermaid.initialize({ 
          startOnLoad: false, 
          theme: "base",
          themeVariables: {
            primaryColor: '#ffffff',        
            primaryTextColor: '#1e1b4b',    
            primaryBorderColor: '#6366f1',  
            lineColor: '#64748b',           
            secondaryColor: '#eff6ff', 
            tertiaryColor: '#ffffff',       
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: '16px',
            edgeLabelBackground: '#ffffff',
            mainBkg: '#ffffff',
            nodeBorder: '#6366f1',
            clusterBkg: '#f8fafc',
            clusterBorder: '#cbd5e1',
            titleColor: '#6366f1'
          },
          securityLevel: "loose",
          flowchart: { 
            htmlLabels: true,
            curve: "basis",
            useMaxWidth: false,
            padding: 40,
            rankSpacing: 80,
            nodeSpacing: 80
          }
        });
        
        const elementId = `mermaid-svg-${id.replace(/[^a-z0-9]/gi, "")}`;
        
        // 渲染重试机制
        let renderResult;
        try {
          renderResult = await mermaid.render(elementId, cleanChart);
        } catch (initialErr) {
          console.warn("First render failed, trying simplified fix...");
          try {
            // 如果第一次失败，尝试移除所有的 class 附加（:::）以及相关定义
            const fallbackChart = cleanChart
              .replace(/:::[a-zA-Z0-9_-]+/g, "")
              .replace(/classDef\s+.*$/gm, "")
              .replace(/class\s+[a-zA-Z0-9_-]+(\s*,?\s*[a-zA-Z0-9_-]+)*$/gm, "")
              .split('\n')
              .filter(line => !line.trim().startsWith('%'))
              .join('\n');
            renderResult = await mermaid.render(`${elementId}-retry`, fallbackChart);
          } catch (secondErr) {
            console.error("Fallback render also failed", secondErr);
            throw secondErr;
          }
        }

        const { svg } = renderResult;
        
        if (isMounted && containerRef.current) {
          containerRef.current.innerHTML = svg;
          
          const svgElement = containerRef.current.querySelector('svg');
          if (svgElement) {
            svgElement.style.width = '100%';
            svgElement.style.height = '100%';
            svgElement.style.maxWidth = 'none';
            svgElement.style.filter = 'drop-shadow(0 12px 40px rgba(99, 102, 241, 0.15))';
          }
          // 强制触发一次重排以便 InteractiveCanvas 计算
          setTimeout(() => {
            window.dispatchEvent(new Event("resize"));
          }, 100);
        }
      } catch (err) {
        console.error("Mermaid Render Fail Event:", err);
        if (isMounted) setError("拓扑逻辑图生成包含不支持的字符。在下方的输入框简单回复以重试，系统已启用更严格的兼容性规范。");
      }
    };

    const timer = setTimeout(renderChart, 200);
    return () => { isMounted = false; clearTimeout(timer); };
  }, [chart, id]);

  if (error) {
    return (
      <div className="flex flex-col gap-2 p-6 rounded-[2rem] bg-amber-50 border border-amber-100 text-amber-700 text-sm shadow-sm">
        <div className="flex items-center gap-2 font-black text-[10px] uppercase tracking-widest text-amber-800">
          <AlertCircle size={14} />
          拓扑代码解析失败
        </div>
        <p className="opacity-80 text-xs leading-relaxed">当前生成的逻辑结构可能包含图形引擎无法处理的语法，建议微调描述后重新生成。</p>
      </div>
    );
  }

  return (
    <InteractiveCanvas 
      id={id} 
      title="Architecture Logic Render" 
      onExportPng={handleExportPng} 
      onExportSvg={handleExportSvg}
      isExporting={isExporting}
      defaultCollapsed={!isVisible}
    >
      <div ref={containerRef} className="w-full flex justify-center items-center" />
    </InteractiveCanvas>
  );
};


interface ChatBubbleProps {
  message: Message;
  onConvert: (id: string) => void;
  key?: React.Key;
}

/** Main Chat Bubble */
function ChatBubble({ message, onConvert }: ChatBubbleProps) {
  const [showMermaid, setShowMermaid] = useState(false);
  const isUser = message.role === 'user';
  
  const parsed = useMemo((): ParsedContent => {
    if (message.role !== 'assistant') return { ascii: null, mermaid: null, analysis: null, raw: message.content };
    
    const asciiMatch = message.content.match(/<ascii_diagram>([\s\S]*?)<\/ascii_diagram>/);
    const mermaidMatch = message.content.match(/<hidden_mermaid>([\s\S]*?)<\/hidden_mermaid>/);
    const analysisMatch = message.content.match(/<text_analysis>([\s\S]*?)<\/text_analysis>/);
    
    return {
      ascii: asciiMatch ? asciiMatch[1].trim() : null,
      mermaid: mermaidMatch ? mermaidMatch[1].trim() : null,
      analysis: analysisMatch ? analysisMatch[1].trim() : null,
      raw: message.content
    };
  }, [message.content, message.role]);

  const hasXmlTags = !!(parsed.ascii || parsed.mermaid || parsed.analysis);

  return (
    <div className={cn(
      "flex w-full mb-8",
      isUser ? "justify-end" : "justify-start"
    )}>
      <div className={cn(
        "rounded-3xl p-6 shadow-md transition-all",
        isUser 
          ? "max-w-[85%] bg-indigo-600 text-white shadow-indigo-100" 
          : "max-w-[98%] lg:max-w-[95%] bg-white border border-slate-200 text-slate-800"
      )}>
        {isUser ? (
          <p className="whitespace-pre-wrap leading-relaxed text-sm md:text-base">{message.content}</p>
        ) : (
          <div className="space-y-6">
            {!hasXmlTags ? (
              <p className="whitespace-pre-wrap leading-relaxed text-sm md:text-base">{message.content}</p>
            ) : (
              <>
                {/* ASCII Layer */}
                {parsed.ascii && (
                  <div className="space-y-3">
                    <InteractiveCanvas 
                      id={`ascii-${message.id}`} 
                      title="Architectural Spatial Topology"
                      theme="dark"
                      canToggle={false}
                    >
                      <pre className="font-mono text-[16px] leading-[1.35] text-white p-20 whitespace-pre">
                        {parsed.ascii}
                      </pre>
                    </InteractiveCanvas>
                  </div>
                )}

                {/* Mermaid Layer */}
                {parsed.mermaid && (
                  <div className="space-y-4">
                    <button
                      onClick={() => setShowMermaid(!showMermaid)}
                      className={cn(
                        "w-full group relative overflow-hidden flex items-center justify-between px-5 py-3.5 rounded-2xl border shadow-sm hover:shadow-md transition-all active:scale-[0.99]",
                        showMermaid 
                          ? "bg-indigo-50/80 border-indigo-200 text-indigo-900" 
                          : "bg-gradient-to-br from-indigo-500 to-indigo-600 text-white border-indigo-400"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "p-2 rounded-lg transition-colors",
                          showMermaid 
                            ? "bg-white text-indigo-600 shadow-sm" 
                            : "bg-white/20 text-white"
                        )}>
                          <Share2 size={18} className="group-hover:rotate-12 transition-transform" />
                        </div>
                        <div className="text-left">
                          <div className="text-sm font-bold tracking-tight">
                            {showMermaid ? "收起逻辑拓扑图" : "展开逻辑拓扑图"}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={cn(
                              "flex h-1.5 w-1.5 rounded-full animate-pulse",
                              showMermaid ? "bg-emerald-500" : "bg-emerald-300"
                            )} />
                            <span className={cn(
                              "text-[9px] font-bold uppercase tracking-wider",
                              showMermaid ? "text-indigo-400" : "text-indigo-100"
                            )}>Engine: Mermaid / HD Render</span>
                          </div>
                        </div>
                      </div>
                      <div className={cn(
                        "p-1 px-2 border rounded-lg text-[10px] transition-colors flex items-center gap-1",
                        showMermaid
                          ? "border-indigo-200 text-indigo-500 bg-white"
                          : "border-indigo-400/50 text-indigo-50 bg-white/10"
                      )}>
                        {showMermaid ? "收起" : "展开"} 
                        {showMermaid ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </div>
                    </button>

                    {showMermaid && (
                      <div className="animate-in fade-in zoom-in-95 duration-500">
                        <MermaidRenderer chart={parsed.mermaid} id={message.id} isVisible={true} />
                      </div>
                    )}
                  </div>
                )}

                {/* Analysis Layer */}
                {parsed.analysis && (
                  <div className="pt-2 border-t border-slate-100">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-3">
                      Technical Insight
                    </div>
                    <div className="prose prose-slate max-w-none text-slate-700 text-sm md:text-base leading-relaxed whitespace-pre-wrap">
                      {parsed.analysis}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// --- App Root ---

export default function App() {
  // Config State
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem('ai_base_url') || DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('ai_api_key') || '');
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  // Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Persistence
  useEffect(() => {
    localStorage.setItem('ai_base_url', baseUrl);
    localStorage.setItem('ai_api_key', apiKey);
  }, [baseUrl, apiKey]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !apiKey || isLoading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      id: crypto.randomUUID(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Force Inject System Prompt
      const requestMessages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: input }
      ];

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat', // 自动指向最新的 DeepSeek-V3
          messages: requestMessages,
          stream: false
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown request error' }));
        throw new Error(errorData.error?.message || `Request failed with status ${response.status}`);
      }

      const data = await response.json();
      const assistantContent = data.choices[0].message.content;

      const assistantMessage: Message = {
        role: 'assistant',
        content: assistantContent,
        id: crypto.randomUUID(),
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error: any) {
      console.error(error);
      const errorMessage: Message = {
        role: 'system',
        id: crypto.randomUUID(),
        content: `Error: ${error.message || 'Check your network and API key'}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const isButtonDisabled = !apiKey.trim() || !input.trim() || isLoading;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans flex flex-col antialiased">
      {/* Header / Config Panel */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-xl border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-indigo-600 to-blue-700 rounded-2xl text-white shadow-xl shadow-indigo-200">
              <Cpu size={24} />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-slate-800">Engineering AI Lab</h1>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Protocol Monitor Active</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsConfigOpen(!isConfigOpen)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all",
                isConfigOpen 
                  ? "bg-indigo-50 text-indigo-600 border border-indigo-100" 
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 border border-transparent"
              )}
            >
              <Settings size={18} />
              <span className="hidden md:inline">配置端点</span>
            </button>
            <button
              onClick={() => setMessages([])}
              className="p-2.5 rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-500 border border-transparent hover:border-red-100 transition-all"
              title="Reset Lab Environment"
            >
              <Trash2 size={20} />
            </button>
          </div>
        </div>

        <AnimatePresence>
          {isConfigOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden bg-slate-50 border-b border-indigo-100"
            >
              <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em] ml-1">DeepSeek API Endpoint (V3 Ready)</label>
                    <div className="relative">
                      <input
                        type="text"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder="https://api.deepseek.com/v1"
                        className="w-full h-14 px-5 bg-white border-2 border-slate-200 rounded-2xl text-sm font-medium focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 outline-none transition-all"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 pl-1 italic">注：v1 路径是官方 V3 通用兼容路径</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em] ml-1">Master API Key</label>
                    <div className="relative">
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-...."
                        className="w-full h-14 px-5 bg-white border-2 border-slate-200 rounded-2xl text-sm font-medium focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 outline-none transition-all"
                      />
                      {apiKey && <div className="absolute right-4 top-4 text-emerald-500"><Check size={20} /></div>}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Main Chat View */}
      <main className="flex-1 overflow-y-auto max-w-6xl w-full mx-auto px-6 py-8">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center space-y-8 text-center opacity-70 py-24">
            <div className="relative">
              <div className="w-24 h-24 bg-white border border-slate-200 rounded-[2rem] flex items-center justify-center shadow-2xl shadow-indigo-100 rotate-6 transition-transform hover:rotate-0 duration-500">
                <Code2 size={40} className="text-indigo-500" />
              </div>
              <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg -rotate-12">
                <Share2 size={20} />
              </div>
            </div>
            <div className="space-y-3">
              <h2 className="text-2xl font-black tracking-tight text-slate-800">欢迎进入工程指令实验室</h2>
              <p className="text-slate-500 max-w-lg mx-auto text-sm md:text-base font-medium">
                这是一个高精度的技术对话环境。系统会自动识别您的需求，在必要时生成精密 ASCII 架构图与动态逻辑树。
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-3">
              {["空调制冷逻辑", "PLC 控制时序", "水泵循环系统", "异常排查方案"].map((tag) => (
                <button 
                  key={tag}
                  onClick={() => setInput(tag)}
                  className="px-5 py-2.5 bg-white border border-slate-200 rounded-2xl text-xs font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-600 hover:shadow-lg transition-all"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="pb-40 space-y-4">
            {messages.map((m) => (
              <ChatBubble 
                key={m.id} 
                message={m} 
                onConvert={() => {}} 
              />
            ))}
            {isLoading && (
              <div className="flex justify-start mb-8">
                <div className="bg-white border-2 border-slate-100 rounded-3xl p-6 flex items-center gap-4 shadow-sm">
                  <div className="flex gap-2">
                    <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce" />
                  </div>
                  <span className="text-xs font-black text-indigo-500 uppercase tracking-[0.3em]">
                    Parsing Logic Model...
                  </span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        )}
      </main>

      {/* Input Overlay */}
      <div className="fixed bottom-0 left-0 right-0 p-6 md:p-10 pointer-events-none">
        <div className="max-w-6xl mx-auto w-full pointer-events-auto">
          <div className="relative group bg-white p-3 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.15)] border-2 border-slate-100 focus-within:border-indigo-400 focus-within:ring-8 focus-within:ring-indigo-500/5 transition-all">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={apiKey ? "输入一个工程技术命题 (例：分析空调制冷系统的压力传递过程...)" : "⚠️ 请先在顶部配置 API Key"}
              disabled={!apiKey || isLoading}
              className="w-full py-4 px-6 bg-transparent border-none outline-none text-base font-medium placeholder:text-slate-300 resize-none pr-20 min-h-[64px] max-h-48"
            />
            <button
              onClick={handleSend}
              disabled={isButtonDisabled}
              className={cn(
                "absolute right-4 bottom-4 w-14 h-14 rounded-3xl flex items-center justify-center transition-all",
                isButtonDisabled 
                  ? "bg-slate-100 text-slate-300 cursor-not-allowed" 
                  : "bg-indigo-600 text-white shadow-xl shadow-indigo-200 hover:translate-y-[-2px] hover:shadow-indigo-300 active:scale-90"
              )}
            >
              {isLoading ? <RefreshCw className="animate-spin" size={24} /> : <Send size={24} />}
            </button>
          </div>
          <div className="flex justify-between px-8 mt-4">
            <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.3em]">
              Hybrid Rendering Engine v1.2
            </p>
            <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.3em]">
              System Authority: Professional Expert
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
