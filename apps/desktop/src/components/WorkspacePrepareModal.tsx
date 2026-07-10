import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useTodoStore } from "@/store";
import { prepareWorkspace, attachAssets } from "@/services/agent";
import type { TodoItem } from "@/types";
import { FolderOpen, Paperclip, ShieldCheck, X } from "@phosphor-icons/react";

export function WorkspacePrepareModal({
  todo,
  onClose,
}: {
  todo: TodoItem;
  onClose: () => void;
}) {
  const { setTodoWorkdir, setValidationCommands } = useTodoStore();
  const workspace = useTodoStore(
    (s) => s.todos.find((t) => t.id === todo.id)?.workspace
  );
  const [commandsText, setCommandsText] = useState(
    (workspace?.validationCommands ?? []).join("\n")
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ensureWorkspace = async () => {
    if (workspace) return workspace;
    return prepareWorkspace(todo.id);
  };

  const pickWorkdir = async () => {
    setError("");
    try {
      await ensureWorkspace();
      const dir = await open({ directory: true, multiple: false });
      if (typeof dir === "string" && dir) {
        setTodoWorkdir(todo.id, dir);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const pickAssets = async () => {
    setError("");
    setBusy(true);
    try {
      await ensureWorkspace();
      const files = await open({ multiple: true });
      const paths = Array.isArray(files) ? files : files ? [files] : [];
      if (paths.length > 0) {
        await attachAssets(todo.id, paths as string[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveCommands = async () => {
    setError("");
    setBusy(true);
    try {
      await ensureWorkspace();
      const commands = commandsText
        .split("\n")
        .map((c) => c.trim())
        .filter(Boolean);
      setValidationCommands(todo.id, commands);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal workspace-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>准备工作区</h3>
          <span className="safe-mode-badge">
            <ShieldCheck size={13} weight="bold" />
            安全模式
          </span>
          <button className="modal-close" onClick={onClose} type="button" aria-label="关闭">
            <X size={15} />
          </button>
        </div>
        <p className="workspace-todo-title">{todo.title}</p>
        <p className="safe-mode-hint">
          安全模式下：执行固定在所选工作目录内，禁止 push/deploy；若配置了校验命令，需全部通过才会自动完成待办（未配置校验命令则 agent 成功即完成）。
        </p>

        <div className="workspace-field">
          <label>工作目录</label>
          <div className="workspace-field-row">
            <span className="workspace-path" title={workspace?.workdir}>
              {workspace?.workdir || "未设置（默认使用待办工作区目录）"}
            </span>
            <button type="button" className="btn-secondary" onClick={pickWorkdir}>
              <FolderOpen size={14} />
              选择目录
            </button>
          </div>
        </div>

        <div className="workspace-field">
          <label>附件（复制到工作区 assets/）</label>
          <div className="workspace-field-row">
            <span className="workspace-assets">
              {workspace?.assets.length
                ? workspace.assets.map((a) => a.name).join("、")
                : "暂无附件"}
            </span>
            <button type="button" className="btn-secondary" onClick={pickAssets} disabled={busy}>
              <Paperclip size={14} />
              添加附件
            </button>
          </div>
        </div>

        <div className="workspace-field">
          <label>校验命令（可选，每行一条，全部通过才算完成）</label>
          <textarea
            rows={3}
            value={commandsText}
            placeholder={"例如：\npnpm test\npnpm build"}
            onChange={(e) => setCommandsText(e.target.value)}
          />
        </div>

        {error && <p className="workspace-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn-primary" onClick={saveCommands} disabled={busy}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
