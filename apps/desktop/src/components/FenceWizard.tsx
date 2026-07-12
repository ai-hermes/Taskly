import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { CheckCircle, Crosshair, Trash, X } from "@phosphor-icons/react";
import { normalizeFence } from "@/services/fence";
import type { FenceRect } from "@/types";

interface FenceWizardProps {
  appName: string;
  fences?: FenceRect[];
  onSave: (fences: FenceRect[]) => void;
  onClear: () => void;
  onClose: () => void;
}

type Step = 1 | 2 | 3;

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/**
 * Step-by-step wizard to draw a per-app capture fence — a set of rectangles
 * (relative coordinates) — on a sample screenshot: 1) countdown + capture,
 * 2) drag to add one or more regions, 3) confirm & save.
 */
export function FenceWizard({ appName, fences, onSave, onClear, onClose }: FenceWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [screenshotPath, setScreenshotPath] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [rects, setRects] = useState<FenceRect[]>(fences ?? []);
  const [draft, setDraft] = useState<FenceRect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const capture = useCallback(async () => {
    setCaptureError(null);
    try {
      const path = await invoke<string>("capture_screenshot", {
        whitelist: [appName],
      });
      if (!path) throw new Error("截图失败：未生成图片");
      setScreenshotPath(path);
      setStep(2);
    } catch (err) {
      setCaptureError(
        `截图失败，请确认 ${appName} 窗口在前台且已授予屏幕录制权限。(${err instanceof Error ? err.message : String(err)})`
      );
    } finally {
      setCountdown(null);
    }
  }, [appName]);

  // Countdown then capture, giving the user time to bring the app forward.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      void capture();
      return;
    }
    const t = window.setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => window.clearTimeout(t);
  }, [countdown, capture]);

  const relativePoint = (e: React.PointerEvent): { x: number; y: number } | null => {
    const el = canvasRef.current;
    if (!el) return null;
    const bounds = el.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      x: Math.min(Math.max((e.clientX - bounds.left) / bounds.width, 0), 1),
      y: Math.min(Math.max((e.clientY - bounds.top) / bounds.height, 0), 1),
    };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    const p = relativePoint(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = p;
    setDraft({ x: p.x, y: p.y, width: 0, height: 0 });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const p = relativePoint(e);
    if (!p) return;
    const start = dragStart.current;
    setDraft({
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      width: Math.abs(p.x - start.x),
      height: Math.abs(p.y - start.y),
    });
  };

  const handlePointerUp = () => {
    dragStart.current = null;
    setDraft((d) => {
      const norm = d ? normalizeFence(d) : null;
      if (norm) setRects((prev) => [...prev, norm]);
      return null;
    });
  };

  const removeRect = (index: number) =>
    setRects((prev) => prev.filter((_, i) => i !== index));

  const renderRect = (rect: FenceRect, key: string, index?: number) => (
    <div
      key={key}
      className="fence-rect"
      style={{
        left: pct(rect.x),
        top: pct(rect.y),
        width: pct(rect.width),
        height: pct(rect.height),
      }}
    >
      {index !== undefined && <span className="fence-rect-index">{index + 1}</span>}
    </div>
  );

  const renderCanvas = (interactive: boolean) => {
    const maskId = `fence-mask-${interactive ? "edit" : "view"}`;
    const holes = [...rects, ...(draft && draft.width > 0 && draft.height > 0 ? [draft] : [])];
    return (
      <div
        ref={interactive ? canvasRef : undefined}
        className={`fence-canvas ${interactive ? "interactive" : ""}`}
        onPointerDown={interactive ? handlePointerDown : undefined}
        onPointerMove={interactive ? handlePointerMove : undefined}
        onPointerUp={interactive ? handlePointerUp : undefined}
      >
        {screenshotPath && (
          <img src={convertFileSrc(screenshotPath)} alt={`${appName} 截图`} draggable={false} />
        )}
        {holes.length > 0 && (
          <svg
            className="fence-mask"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <mask id={maskId}>
                <rect x="0" y="0" width="100" height="100" fill="white" />
                {holes.map((r, i) => (
                  <rect
                    key={`hole-${i}`}
                    x={r.x * 100}
                    y={r.y * 100}
                    width={r.width * 100}
                    height={r.height * 100}
                    fill="black"
                  />
                ))}
              </mask>
            </defs>
            <rect
              x="0"
              y="0"
              width="100"
              height="100"
              fill="rgba(0,0,0,0.5)"
              mask={`url(#${maskId})`}
            />
          </svg>
        )}
        {rects.map((r, i) => renderRect(r, `rect-${i}`, i))}
        {draft && draft.width > 0 && draft.height > 0 && renderRect(draft, "draft")}
      </div>
    );
  };

  return (
    <div className="fence-wizard-backdrop" role="dialog" aria-label="设置抓取围栏">
      <div className="fence-wizard">
        <header className="fence-wizard-header">
          <h3>
            <Crosshair size={16} /> 设置抓取围栏 · {appName}
          </h3>
          <button type="button" className="btn-icon" aria-label="关闭" onClick={onClose}>
            <X size={15} />
          </button>
        </header>

        <ol className="fence-steps" aria-hidden="true">
          {["截图", "框选区域", "确认保存"].map((label, i) => (
            <li key={label} className={step === i + 1 ? "active" : step > i + 1 ? "done" : ""}>
              <span>{i + 1}</span>
              {label}
            </li>
          ))}
        </ol>

        {step === 1 && (
          <div className="fence-step-body">
            <p>
              请将 <strong>{appName}</strong> 窗口切换到前台。点击「开始截图」后有 3
              秒倒计时，请利用这段时间切换窗口。
            </p>
            {captureError && <p className="fence-error">{captureError}</p>}
            {countdown !== null ? (
              <div className="fence-countdown">{countdown > 0 ? countdown : "…"}</div>
            ) : (
              <button type="button" className="btn-primary" onClick={() => setCountdown(3)}>
                开始截图
              </button>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="fence-step-body">
            <p>
              在截图上按住拖拽，框出允许抓取的区域，可框选<strong>多个矩形</strong>
              （例如左侧会话列表 + 右侧消息区，避开底部输入框）。
            </p>
            {renderCanvas(true)}
            <div className="fence-rect-list">
              {rects.length === 0 ? (
                <span className="fence-readout-empty">尚未框选区域（可框选多个）</span>
              ) : (
                rects.map((r, i) => (
                  <span className="fence-rect-chip" key={`chip-${i}`}>
                    <b>{i + 1}</b>
                    {pct(r.width)} × {pct(r.height)}
                    <button
                      type="button"
                      aria-label={`删除区域 ${i + 1}`}
                      onClick={() => removeRect(i)}
                    >
                      <X size={11} weight="bold" />
                    </button>
                  </span>
                ))
              )}
            </div>
            <div className="fence-actions">
              <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
                重新截图
              </button>
              {rects.length > 0 && (
                <button type="button" className="btn-secondary" onClick={() => setRects([])}>
                  <Trash size={14} /> 全部清空
                </button>
              )}
              <button
                type="button"
                className="btn-primary"
                disabled={rects.length === 0}
                onClick={() => setStep(3)}
              >
                下一步
              </button>
            </div>
          </div>
        )}

        {step === 3 && rects.length > 0 && (
          <div className="fence-step-body">
            <p>
              确认后，<strong>{appName}</strong> 只有 {rects.length}{" "}
              个高亮区域内的文字会参与 todo 抓取，围栏外（变暗部分）的内容将被忽略。
            </p>
            {renderCanvas(false)}
            <div className="fence-actions">
              <button type="button" className="btn-secondary" onClick={() => setStep(2)}>
                重新框选
              </button>
              {fences && fences.length > 0 && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    onClear();
                    onClose();
                  }}
                >
                  清除围栏
                </button>
              )}
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  onSave(rects);
                  onClose();
                }}
              >
                <CheckCircle size={15} /> 保存围栏
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
