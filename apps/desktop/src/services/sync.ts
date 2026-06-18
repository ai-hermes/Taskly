import type { TodoItem } from "@/types";

interface SyncPayload {
  todos: TodoItem[];
  timestamp: number;
  deviceId: string;
}

export class SyncService {
  private serverUrl: string;
  private deviceId: string;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
    this.deviceId = this.getDeviceId();
  }

  private getDeviceId(): string {
    let id = localStorage.getItem("taskly_device_id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("taskly_device_id", id);
    }
    return id;
  }

  async push(todos: TodoItem[]): Promise<void> {
    const payload: SyncPayload = {
      todos,
      timestamp: Date.now(),
      deviceId: this.deviceId,
    };

    const response = await fetch(`${this.serverUrl}/api/v1/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Sync push failed: ${response.statusText}`);
    }
  }

  async pull(): Promise<TodoItem[]> {
    const response = await fetch(`${this.serverUrl}/api/v1/sync/pull`);
    if (!response.ok) {
      throw new Error(`Sync pull failed: ${response.statusText}`);
    }
    const data: SyncPayload = await response.json();
    return data.todos;
  }
}
