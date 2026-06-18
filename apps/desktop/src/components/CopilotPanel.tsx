import { useAppState } from "@/store";

export function CopilotPanel() {
  const { monitoring, lastOcrText, setCopilotVisible } = useAppState();

  return (
    <div className="copilot-panel">
      <div className="copilot-header">
        <span className="copilot-title">🤖 Taskly Copilot</span>
        <button className="copilot-close" onClick={() => setCopilotVisible(false)}>
          ✕
        </button>
      </div>

      <div className="copilot-body">
        <div className="copilot-status">
          <span className={`status-dot ${monitoring ? "active" : "inactive"}`} />
          <span>{monitoring ? "监控中..." : "已暂停"}</span>
        </div>

        {lastOcrText && (
          <div className="copilot-ocr-preview">
            <h4>最近识别</h4>
            <p className="ocr-text">{lastOcrText.slice(0, 200)}</p>
          </div>
        )}

        {!monitoring && (
          <p className="copilot-hint">
            点击上方按钮开始监控微信窗口
          </p>
        )}
      </div>
    </div>
  );
}
