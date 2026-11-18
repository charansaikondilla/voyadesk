import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, MessageCircle, Send } from "lucide-react";
import { type Message } from "@voyadesk/core";
import { useAction, useList } from "../../lib/hooks";
import { relTime } from "../../lib/format";
import { Avatar, Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Textarea, cx } from "../../components/ui";
import { ThreadPanel } from "../../components/plus";

export function InboxPage() {
  const q = useList("messages");
  const { act, busy } = useAction();
  const [active, setActive] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sim, setSim] = useState(false);
  const [simForm, setSimForm] = useState({ from: "New customer", phone: "+91 99000 88888", body: "Hi! 4N Goa for 2 adults on 20 Dec, budget 60k" });

  const threads = useMemo(() => {
    const byPhone = new Map<string, Message[]>();
    for (const m of q.data ?? []) {
      const k = m.phone || m.from;
      byPhone.set(k, [...(byPhone.get(k) ?? []), m]);
    }
    return [...byPhone.entries()].map(([phone, msgs]) => {
      const sorted = msgs.sort((a, b) => (a.at < b.at ? -1 : 1));
      const last = sorted.at(-1)!;
      const name = sorted.find((m) => m.direction === "in")?.from || phone;
      return { phone, name, msgs: sorted, last, unread: sorted.some((m) => m.direction === "in" && !m.read), leadId: sorted.find((m) => m.leadId)?.leadId ?? null };
    }).sort((a, b) => (a.last.at < b.last.at ? 1 : -1));
  }, [q.data]);
  const cur = threads.find((t) => t.phone === active) ?? threads[0];

  return (
    <div>
      <PageHeader title="Inbox" subtitle="Shared WhatsApp inbox. The bot answers new enquiries and booking-status questions instantly; you take over any time."
        actions={<Button variant="secondary" icon={<MessageCircle className="size-4" />} onClick={() => setSim(true)}>Simulate incoming WhatsApp</Button>} />
      {!q.data ? <Loading /> : threads.length === 0 ? <Empty>No conversations yet.</Empty> : (
        <div className="grid gap-4 md:grid-cols-[280px_1fr]">
          <Card padded={false} className="max-h-[70vh] overflow-y-auto">
            {threads.map((t) => (
              <button key={t.phone} onClick={() => setActive(t.phone)} className={cx("flex w-full items-start gap-3 border-b border-line px-3 py-3 text-left last:border-0", cur?.phone === t.phone ? "bg-brand-50" : "hover:bg-slate-50")}>
                <Avatar name={t.name} />
                <span className="min-w-0 flex-1"><span className="flex justify-between gap-2"><span className="truncate font-medium">{t.name}</span><span className="shrink-0 text-xs text-ink-400">{relTime(t.last.at)}</span></span><span className="block truncate text-xs text-ink-500">{t.last.body}</span></span>
                {t.unread && <span className="mt-1.5 size-2 rounded-full bg-brand-600" aria-label="Unread" />}
              </button>
            ))}
          </Card>
          {cur && (
            <Card padded={false} className="flex max-h-[70vh] flex-col">
              <div className="flex items-center justify-between border-b border-line px-4 py-3"><div><div className="font-medium">{cur.name}</div><div className="text-xs text-ink-500">{cur.phone}</div></div>{cur.leadId && <Link to={`/app/leads/${cur.leadId}`} className="text-sm text-brand-700 hover:underline">Open lead</Link>}</div>
              <div className="flex-1 space-y-2 overflow-y-auto bg-[#efeae2]/40 p-4">
                {cur.msgs.map((m) => (
                  <div key={m.id} className={cx("max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-xs", m.direction === "in" ? "bg-white" : "ml-auto bg-emerald-100")}>
                    {m.handledBy === "bot" && <Badge tone="violet" className="mb-1"><Bot className="size-3" />Bot</Badge>}
                    <div className="whitespace-pre-wrap">{m.body}</div>
                    <div className="mt-1 text-right text-[10px] text-ink-500">{relTime(m.at)}</div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 border-t border-line p-3">
                <Input aria-label="Reply" placeholder="Type a reply…" value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && reply.trim()) { void act("replyMessage", { phone: cur.phone, body: reply, leadId: cur.leadId }).then((r) => r && setReply("")); } }} />
                <Button busy={busy} disabled={!reply.trim()} icon={<Send className="size-4" />} onClick={async () => { const r = await act("replyMessage", { phone: cur.phone, body: reply, leadId: cur.leadId }); if (r) setReply(""); }}>Send</Button>
              </div>
              <ThreadPanel phone={cur.phone} />
            </Card>
          )}
        </div>
      )}
      <Modal open={sim} onClose={() => setSim(false)} title="Simulate an incoming WhatsApp message" footer={<><Button variant="secondary" onClick={() => setSim(false)}>Cancel</Button><Button busy={busy} onClick={async () => { const r = await act("inboundMessage", { channel: "whatsapp", ...simForm }, "Message received — the bot replied"); if (r) { setSim(false); setActive(simForm.phone); } }}>Receive</Button></>}>
        <div className="space-y-3">
          <p className="text-sm text-ink-600">In production this arrives through the signed WhatsApp webhook. Try a trip request, or ask "what's my booking status?" from a customer's number.</p>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Name"><Input value={simForm.from} onChange={(e) => setSimForm({ ...simForm, from: e.target.value })} /></Field><Field label="Phone"><Input value={simForm.phone} onChange={(e) => setSimForm({ ...simForm, phone: e.target.value })} /></Field></div>
          <Field label="Message"><Textarea value={simForm.body} onChange={(e) => setSimForm({ ...simForm, body: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
