import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import {
  CheckCircleIcon,
  CrosshairIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { normalizeFence } from "@/services/fence";
import { activateApp } from "@/services/window";
import type { CaptureResult, FenceRect } from "@/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
 * Step-by-step wizard to draw a per-app capture fence - a set of rectangles
 * (relative coordinates) - on a sample screenshot: 1) countdown + capture,
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
      const result = await invoke<CaptureResult>("capture_screenshot", {
        whitelist: [appName],
        targetApp: appName,
      });
      if (!result?.path) throw new Error("截图失败：未生成图片");
      setScreenshotPath(result.path);
      setStep(2);
    } catch (err) {
      setCaptureError(
        `截图失败，请确认 ${appName} 窗口在前台且已授予屏幕录制权限。(${err instanceof Error ? err.message : String(err)})`
      );
    } finally {
      setCountdown(null);
    }
  }, [appName]);

  // Countdown then capture, giving the app time to come to the foreground.
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      void capture();
      return;
    }
    const t = window.setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => window.clearTimeout(t);
  }, [countdown, capture]);

  const startCapture = useCallback(() => {
    setCaptureError(null);
    // Best-effort: bring the target app to the foreground automatically.
    void activateApp(appName).catch(() => {
      /* ignore; user can switch manually during countdown */
    });
    setCountdown(3);
  }, [appName]);

  const relativePoint = (e: PointerEvent): { x: number; y: number } | null => {
    const el = canvasRef.current;
    if (!el) return null;
    const bounds = el.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      x: Math.min(Math.max((e.clientX - bounds.left) / bounds.width, 0), 1),
      y: Math.min(Math.max((e.clientY - bounds.top) / bounds.height, 0), 1),
    };
  };

  const handlePointerDown = (e: PointerEvent) => {
    const p = relativePoint(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = p;
    setDraft({ x: p.x, y: p.y, width: 0, height: 0 });
  };

  const handlePointerMove = (e: PointerEvent) => {
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="fence-wizard max-w-4xl"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="fence-wizard-header">
          <DialogTitle className="flex items-center gap-2">
            <CrosshairIcon />
            设置抓取围栏 · {appName}
          </DialogTitle>
          <DialogDescription>
            为指定应用框选允许参与 todo 抓取的截图区域。
          </DialogDescription>
        </DialogHeader>

        <ol className="fence-steps" aria-hidden="true">
          {["截图", "框选区域", "确认保存"].map((label, i) => (
            <li key={label} className={step === i + 1 ? "active" : step > i + 1 ? "done" : ""}>
              <Badge variant={step === i + 1 ? "default" : step > i + 1 ? "secondary" : "outline"}>
                {i + 1}
              </Badge>
              {label}
            </li>
          ))}
        </ol>

        {step === 1 && (
          <div className="fence-step-body">
            <p>
              点击「开始截图」后会自动把 <strong>{appName}</strong> 切换到前台，并有 3
              秒倒计时。如未自动切换，请在倒计时内手动切换窗口。
            </p>
            {captureError && (
              <Alert variant="destructive">
                <AlertDescription>{captureError}</AlertDescription>
              </Alert>
            )}
            {countdown !== null ? (
              <div className="fence-countdown">{countdown > 0 ? countdown : "…"}</div>
            ) : (
              <Button type="button" onClick={startCapture}>
                开始截图
              </Button>
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
                  <Badge className="fence-rect-chip" variant="secondary" key={`chip-${i}`}>
                    <b>{i + 1}</b>
                    {pct(r.width)} × {pct(r.height)}
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`删除区域 ${i + 1}`}
                      onClick={() => removeRect(i)}
                    >
                      <XIcon />
                    </Button>
                  </Badge>
                ))
              )}
            </div>
            <div className="fence-actions">
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                重新截图
              </Button>
              {rects.length > 0 && (
                <Button type="button" variant="outline" onClick={() => setRects([])}>
                  <Trash2Icon data-icon="inline-start" />
                  全部清空
                </Button>
              )}
              <Button
                type="button"
                disabled={rects.length === 0}
                onClick={() => setStep(3)}
              >
                下一步
              </Button>
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
              <Button type="button" variant="outline" onClick={() => setStep(2)}>
                重新框选
              </Button>
              {fences && fences.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onClear();
                    onClose();
                  }}
                >
                  清除围栏
                </Button>
              )}
              <Button
                type="button"
                onClick={() => {
                  onSave(rects);
                  onClose();
                }}
              >
                <CheckCircleIcon data-icon="inline-start" />
                保存围栏
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
