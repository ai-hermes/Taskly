import { useAppState } from "@/store";
import { Robot, X } from "@phosphor-icons/react";

export function CopilotPanel() {
  const { monitoring, lastOcrText, lastMonitorError, setCopilotVisible } = useAppState();

  return (
    <div className="copilot-panel">
      <div className="copilot-header">
        <span className="copilot-title">
          <Robot size={16} />
          Taskly Copilot
        </span>
        <button
          className="copilot-close"
          onClick={() => setCopilotVisible(false)}
          type="button"
          aria-label="关闭 Copilot"
        >
          <X size={15} />
        </button>
      </div>

      <div className="copilot-body">
        <div className="copilot-status">
          <span className={`status-dot ${monitoring ? "active" : "inactive"}`} />
          <span>{monitoring ? "监控中…" : "已暂停"}</span>
        </div>

        {lastOcrText && (
          <div className="copilot-ocr-preview">
            <h4>最近识别</h4>
            <p className="ocr-text">{lastOcrText.slice(0, 200)}</p>
          </div>
        )}

        {lastMonitorError && (
          <div className="copilot-ocr-preview">
            <h4>最近错误</h4>
            <p className="ocr-text">{lastMonitorError}</p>
          </div>
        )}

        {!monitoring && (
          <p className="copilot-hint">
            点击“开始监控”后，最近识别的聊天内容会显示在这里。
          </p>
        )}
      </div>
    </div>
  );
}
