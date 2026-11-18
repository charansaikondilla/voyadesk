import { useState, type ReactNode } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { canWrite, isDeletable, type Collection, type Entity } from "@voyadesk/core";
import { api } from "../lib/api";
import { useList, useMutation } from "../lib/hooks";
import { useSession } from "../lib/session";
import { cleanValues, EntityForm, type FieldDef } from "./forms";
import { Button, Confirm, DataTable, ErrorNote, Loading, Modal, PageHeader, type Column } from "./ui";

export interface ResourceConfig<C extends Collection> {
  collection: C;
  title: string;
  singular: string;
  subtitle?: ReactNode;
  columns: Column<Entity<C>>[];
  fields: FieldDef[];
  defaults?: Record<string, unknown>;
  search: (row: Entity<C>) => string;
  onRowClick?: (row: Entity<C>) => void;
  headerActions?: ReactNode;
  embedded?: boolean;
  filter?: (row: Entity<C>) => boolean;
}

export function ResourcePage<C extends Collection>(cfg: ResourceConfig<C>) {
  const { user } = useSession();
  const q = useList(cfg.collection);
  const m = useMutation();
  const [editing, setEditing] = useState<Entity<C> | "new" | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [deleting, setDeleting] = useState<Entity<C> | null>(null);
  const writable = user ? canWrite(user.role, cfg.collection) && !["agent", "driver"].includes(user.role) : false;

  const open = (row: Entity<C> | "new") => {
    m.setFieldErrors({});
    setEditing(row);
    setValues(row === "new" ? { ...(cfg.defaults ?? {}) } : Object.fromEntries(cfg.fields.map((f) => [f.name, (row as unknown as Record<string, unknown>)[f.name]])));
  };

  const save = async () => {
    const body = cleanValues(cfg.fields, values);
    const r = await m.run(
      () => (editing === "new" ? api.create(cfg.collection, body) : api.update(cfg.collection, (editing as Entity<C>).id, body)),
      editing === "new" ? `${cfg.singular} added` : "Changes saved",
    );
    if (r) setEditing(null);
  };

  const actions: Column<Entity<C>>[] = writable ? [{
    key: "_actions", header: "", align: "right", hideOnMobile: false,
    render: (r) => {
      const del = isDeletable(cfg.collection, r);
      return (
        <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => open(r)}><Pencil className="size-4" /></Button>
          {del === true && <Button size="sm" variant="ghost" aria-label="Delete" onClick={() => setDeleting(r)}><Trash2 className="size-4 text-rose-600" /></Button>}
        </span>
      );
    },
  }] : [];

  const rows = (q.data ?? []).filter((r) => (cfg.filter ? cfg.filter(r) : true));
  const addBtn = writable ? <Button icon={<Plus className="size-4" />} onClick={() => open("new")}>Add {cfg.singular.toLowerCase()}</Button> : null;

  return (
    <div>
      {!cfg.embedded && <PageHeader title={cfg.title} subtitle={cfg.subtitle} actions={<>{cfg.headerActions}{addBtn}</>} />}
      {cfg.embedded && <h2 className="mb-2 text-base font-semibold text-ink-900">{cfg.title}</h2>}
      {q.error && !q.data ? <ErrorNote message={q.error.message} onRetry={q.reload} /> : !q.data ? <Loading /> : (
        <DataTable rows={rows} columns={[...cfg.columns, ...actions]} search={cfg.search} onRowClick={cfg.onRowClick ?? (writable ? open : undefined)}
          toolbar={cfg.embedded ? addBtn : undefined}
          empty={<>No {cfg.title.toLowerCase()} yet.{writable && " Add the first one."}</>} />
      )}
      <Modal open={editing !== null} onClose={() => setEditing(null)} size="lg" title={editing === "new" ? `Add ${cfg.singular.toLowerCase()}` : `Edit ${cfg.singular.toLowerCase()}`}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button busy={m.busy} onClick={save}>Save</Button></>}>
        <EntityForm fields={cfg.fields} values={values} onChange={setValues} errors={m.fieldErrors} />
      </Modal>
      <Confirm open={deleting !== null} onClose={() => setDeleting(null)} danger title={`Delete ${cfg.singular.toLowerCase()}?`} confirmLabel="Delete" busy={m.busy}
        message="This can't be undone."
        onConfirm={async () => {
          if (!deleting) return;
          const ok = await m.run(() => api.remove(cfg.collection, deleting.id).then(() => true), `${cfg.singular} deleted`);
          if (ok !== undefined) setDeleting(null);
        }} />
    </div>
  );
}
