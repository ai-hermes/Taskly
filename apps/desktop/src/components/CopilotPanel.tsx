import { useAppState, useTodoStore, useExecutionStore } from "@/store";
import { Robot, X, Lightning } from "@phosphor-icons/react";
import type { TodoExecutionStatus } from "@/types";

const STATUS_LABELS: Record<TodoExecutionStatus, string> = {
  idle: "空闲",
  workspace_ready: "工作区就绪",
  running: "执行中",
  waiting_input: "等待回复",
  validating: "校验中",
  needs_review: "待审阅",
  succeeded: "已完成",
  failed: "失败",
};

export function CopilotPanel() {
  const { monitoring, lastOcrText, lastMonitorError, setCopilotVisible } = useAppState();
  const setActiveTodo = useExecutionStore((s) => s.setActiveTodo);
  const lastExecuted = useTodoStore((s) => {
    const withExec = s.todos.filter((t) => t.execution?.runId);
    if (withExec.length === 0) return undefined;
    return withExec.reduce((a, b) =>
      (a.execution!.startedAt ?? "") >= (b.execution!.startedAt ?? "") ? a : b
    );
  });

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

        {lastExecuted?.execution && (
          <div
            className="copilot-exec-card"
            role="button"
            onClick={() => setActiveTodo(lastExecuted.id)}
            title="查看执行会话"
          >
            <h4>
              <Lightning size={13} weight="fill" />
              最近一次执行
            </h4>
            <p className="exec-card-title">{lastExecuted.title}</p>
            <p className={`exec-card-status ${lastExecuted.execution.status}`}>
              {lastExecuted.execution.runId} ·{" "}
              {STATUS_LABELS[lastExecuted.execution.status] ??
                lastExecuted.execution.status}
            </p>
            {lastExecuted.execution.summary && (
              <p className="exec-card-summary">{lastExecuted.execution.summary}</p>
            )}
            {lastExecuted.execution.error && (
              <p className="exec-card-error">{lastExecuted.execution.error}</p>
            )}
          </div>
        )}

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
