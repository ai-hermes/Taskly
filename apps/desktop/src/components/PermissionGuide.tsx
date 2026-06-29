import { useState } from "react";
import {
  requestScreenRecordingPermission,
  openScreenRecordingSettings,
  checkScreenRecordingPermission,
} from "@/services/permissions";

interface Props {
  onGranted: () => void;
  onDismiss: () => void;
}

/**
 * Onboarding banner that guides the user to grant macOS Screen Recording
 * permission, which is required to capture WeChat windows for OCR.
 */
export function PermissionGuide({ onGranted, onDismiss }: Props) {
  const [requesting, setRequesting] = useState(false);
  const [prompted, setPrompted] = useState(false);

  const handleRequest = async () => {
    setRequesting(true);
    const granted = await requestScreenRecordingPermission();
    setRequesting(false);
    setPrompted(true);
    if (granted) {
      onGranted();
    }
  };

  const handleRecheck = async () => {
    const granted = await checkScreenRecordingPermission();
    if (granted) {
      onGranted();
    }
  };

  return (
    <div className="permission-guide">
      <div className="permission-card">
        <div className="permission-icon">🔒</div>
        <h2>需要「屏幕录制」权限</h2>
        <p>
          Taskly 需要「屏幕录制 / Screen &amp; System Audio Recording」权限，
          才能截取微信窗口并识别其中的待办事项。
          <br />
          所有截图与识别都在本地完成，不会上传。
        </p>

        <ol className="permission-steps">
          <li>点击下方「授予权限」，在弹窗中允许 Taskly</li>
          <li>
            若未弹窗，点击「打开系统设置」，在
            <b>隐私与安全性 → 屏幕录制</b>中勾选 Taskly
          </li>
          <li>授权后可能需要<b>重启 Taskly</b>才能生效</li>
        </ol>

        <div className="permission-actions">
          <button
            className="btn-primary"
            onClick={handleRequest}
            disabled={requesting}
          >
            {requesting ? "请求中..." : "授予权限"}
          </button>
          <button className="btn-secondary" onClick={openScreenRecordingSettings}>
            打开系统设置
          </button>
          <button className="btn-secondary" onClick={handleRecheck}>
            我已授权，重新检查
          </button>
        </div>

        {prompted && (
          <p className="permission-hint">
            如果仍未生效，请在系统设置中确认已勾选 Taskly，并重启应用。
          </p>
        )}

        <button className="permission-skip" onClick={onDismiss}>
          稍后再说
        </button>
      </div>
    </div>
  );
}
