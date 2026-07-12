import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpenIcon, PaperclipIcon, ShieldCheckIcon } from "lucide-react";
import { attachAssets, prepareWorkspace } from "@/services/agent";
import { useTodoStore } from "@/store";
import type { TodoItem } from "@/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="workspace-modal max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>准备工作区</DialogTitle>
            <Badge variant="secondary">
              <ShieldCheckIcon />
              安全模式
            </Badge>
          </div>
          <DialogDescription>{todo.title}</DialogDescription>
        </DialogHeader>

        <Alert>
          <AlertDescription>
            安全模式下：执行固定在所选工作目录内，禁止 push/deploy；若配置了校验命令，需全部通过才会自动完成待办（未配置校验命令则 agent 成功即完成）。
          </AlertDescription>
        </Alert>

        <FieldGroup>
          <Card>
            <CardHeader>
              <CardTitle>工作目录</CardTitle>
              <CardDescription>
                {workspace?.workdir || "未设置（默认使用待办工作区目录）"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button type="button" variant="outline" onClick={pickWorkdir}>
                <FolderOpenIcon data-icon="inline-start" />
                选择目录
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>附件</CardTitle>
              <CardDescription>
                {workspace?.assets.length
                  ? workspace.assets.map((asset) => asset.name).join("、")
                  : "暂无附件"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                variant="outline"
                onClick={pickAssets}
                disabled={busy}
              >
                {busy ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <PaperclipIcon data-icon="inline-start" />
                )}
                添加附件
              </Button>
            </CardContent>
          </Card>

          <Field>
            <FieldLabel htmlFor="validation-commands">
              校验命令（可选）
            </FieldLabel>
            <Textarea
              id="validation-commands"
              rows={3}
              value={commandsText}
              placeholder={"例如：\npnpm test\npnpm build"}
              onChange={(event) => setCommandsText(event.target.value)}
            />
            <FieldDescription>
              每行一条，全部通过才算完成。
            </FieldDescription>
          </Field>
        </FieldGroup>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" onClick={saveCommands} disabled={busy}>
            {busy && <Spinner data-icon="inline-start" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
