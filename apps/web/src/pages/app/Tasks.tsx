import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAction, useList } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { Button, Card, Field, Input, Modal, PageHeader, Select, Tabs } from "../../components/ui";
import { TaskList } from "./Dashboard";

export function TasksPage() {
  const { user } = useSession();
  const q = useList("tasks");
  const users = useList("users");
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<"mine" | "all" | "done">("mine");
  const { act, busy } = useAction();
  const [f, setF] = useState({ title: "", due: new Date(Date.now() + 3600_000).toISOString().slice(0, 16), assigneeId: "", priority: "normal" });
  const rows = useMemo(() => (q.data ?? []).filter((t) => (tab === "done" ? t.done : !t.done && (tab === "all" || t.assigneeId === user?.id))).sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1)), [q.data, tab, user?.id]);
  return (
    <div>
      <PageHeader title="Tasks" subtitle="Follow-ups and to-dos. New leads get a call-within-15-minutes task automatically." actions={<Button icon={<Plus className="size-4" />} onClick={() => setParams({ new: "1" })}>New task</Button>} />
      <Tabs tabs={[{ key: "mine", label: "My open tasks" }, { key: "all", label: "Team's open tasks" }, { key: "done", label: "Done" }]} value={tab} onChange={setTab} />
      <Card><TaskList tasks={rows} /></Card>
      <Modal open={params.get("new") === "1"} onClose={() => setParams({})} title="New task" size="sm" footer={<><Button variant="secondary" onClick={() => setParams({})}>Cancel</Button><Button busy={busy} onClick={async () => { const r = await act("createTask", { title: f.title, dueAt: new Date(f.due).toISOString(), assigneeId: f.assigneeId || null, priority: f.priority }, "Task added"); if (r) { setParams({}); setF({ ...f, title: "" }); } }}>Add task</Button></>}>
        <div className="space-y-3">
          <Field label="Task" required><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Due"><Input type="datetime-local" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
          <Field label="Assign to"><Select value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}><option value="">Me</option>{(users.data ?? []).filter((u) => u.active && !["agent", "driver"].includes(u.role)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          <Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></Select></Field>
        </div>
      </Modal>
    </div>
  );
}
