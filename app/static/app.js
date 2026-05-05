const STATUS_KEYS = ['drafting','sent','replied','interview','offer','rejected','no_reply'];
const STATUS_NAMES = {
  drafting:'Drafting', sent:'Sent', replied:'Replied',
  interview:'Interview', offer:'Offer', rejected:'Rejected', no_reply:'No reply'
};
const STATUS_EMOJI = {
  drafting:'📝', sent:'📤', replied:'💬', interview:'🗓',
  offer:'✅', rejected:'❌', no_reply:'🔇'
};
const STATUS_BAR = {
  drafting:'bg-slate-400', sent:'bg-sky-500', replied:'bg-cyan-500',
  interview:'bg-amber-500', offer:'bg-emerald-500', rejected:'bg-rose-500', no_reply:'bg-zinc-400'
};
const STATUS_PILL = {
  drafting:'bg-slate-100 text-slate-700 border border-slate-200',
  sent:'bg-sky-50 text-sky-700 border border-sky-200',
  replied:'bg-cyan-50 text-cyan-700 border border-cyan-200',
  interview:'bg-amber-50 text-amber-700 border border-amber-200',
  offer:'bg-emerald-50 text-emerald-700 border border-emerald-200',
  rejected:'bg-rose-50 text-rose-700 border border-rose-200',
  no_reply:'bg-zinc-100 text-zinc-600 border border-zinc-200'
};
const TIER_PILL = {
  T1:'bg-brand-100 text-brand-700',
  T2:'bg-sky-100 text-sky-700',
  T3:'bg-slate-100 text-slate-600'
};
const TIER_BAR = {
  T1:'bg-brand-500', T2:'bg-sky-400', T3:'bg-slate-400'
};
const TIER_LABEL = {
  T1:'Direct overlap', T2:'Strong match', T3:'Good match'
};
const FELLOWSHIP_PILL = {
  pending:'bg-slate-100 text-slate-600 border border-slate-200',
  applied:'bg-sky-50 text-sky-700 border border-sky-200',
  awarded:'bg-emerald-50 text-emerald-700 border border-emerald-200',
  rejected:'bg-rose-50 text-rose-700 border border-rose-200',
  ineligible:'bg-zinc-100 text-zinc-500 border border-zinc-200'
};
const CATEGORY_LABEL = {
  renewable:'Renewable energy & smart grid',
  av:'Autonomous vehicles & perception',
  adversarial:'Adversarial ML, security & privacy',
  robotics:'Robotics & UAVs',
  rl:'Reinforcement learning & decision',
  or:'OR, optimization & transportation',
  nlp:'NLP & foundation models',
  cv:'Computer vision, 3D & graphics',
  medical:'Medical imaging & biomed AI',
  theory:'ML theory & general'
};
const CATEGORY_ROW = {
  renewable:'bg-emerald-50/60 hover:bg-emerald-100/80 border-l-4 border-emerald-400',
  av:'bg-cyan-50/60 hover:bg-cyan-100/80 border-l-4 border-cyan-400',
  adversarial:'bg-rose-50/60 hover:bg-rose-100/80 border-l-4 border-rose-400',
  robotics:'bg-indigo-50/60 hover:bg-indigo-100/80 border-l-4 border-indigo-400',
  rl:'bg-amber-50/60 hover:bg-amber-100/80 border-l-4 border-amber-400',
  or:'bg-yellow-50/60 hover:bg-yellow-100/80 border-l-4 border-yellow-400',
  nlp:'bg-fuchsia-50/60 hover:bg-fuchsia-100/80 border-l-4 border-fuchsia-400',
  cv:'bg-violet-50/60 hover:bg-violet-100/80 border-l-4 border-violet-400',
  medical:'bg-sky-50/60 hover:bg-sky-100/80 border-l-4 border-sky-400',
  theory:'bg-slate-50/60 hover:bg-slate-100/80 border-l-4 border-slate-400'
};
const CATEGORY_DOT = {
  renewable:'bg-emerald-400', av:'bg-cyan-400', adversarial:'bg-rose-400',
  robotics:'bg-indigo-400', rl:'bg-amber-400', or:'bg-yellow-400',
  nlp:'bg-fuchsia-400', cv:'bg-violet-400', medical:'bg-sky-400', theory:'bg-slate-400'
};
const CATEGORY_KEYS = ['renewable','av','adversarial','robotics','rl','or','nlp','cv','medical','theory'];

function dashboard() {
  return {
    view: 'overview',
    professors: [],
    fellowships: [],
    activity: [],
    stats: { total:0, by_status:{}, by_tier:{}, by_university:{}, sent_count:0, reply_count:0, response_rate:0, interview_count:0, offer_count:0, pending_followups:0 },
    filters: { q:'', tier:'', status:'', university:'', category:'', missingEmail:false },
    editing: null,
    editingFellowship: null,
    statusKeys: STATUS_KEYS,
    pipelineCols: STATUS_KEYS.map(s => ({ status:s })),
    tabs: [
      { key:'overview',    label:'Overview',    icon:'🏠' },
      { key:'pipeline',    label:'Pipeline',    icon:'📋' },
      { key:'professors',  label:'Professors',  icon:'👥' },
      { key:'drafts',      label:'Drafts',      icon:'✉️' },
      { key:'ready',       label:'Ready to send', icon:'🚀' },
      { key:'fellowships', label:'Fellowships', icon:'💰' },
      { key:'activity',    label:'Activity',    icon:'🕒' },
    ],
    drafts: [],
    draftsQ: '',
    draftsCategory: '',
    editingDraft: null,
    batchData: { batches: [], skipped: [], total_eligible: 0, total_batches: 0, batch_size: 12, max_per_university: 2 },
    batchSize: 12,
    maxPerUni: 2,
    copyToast: '',
    saveTimer: null,
    saveState: '',

    async init() {
      await Promise.all([this.load(), this.loadFellowships(), this.loadActivity(), this.loadStats(), this.loadDrafts(), this.loadBatches()]);
    },

    async loadBatches() {
      const r = await fetch(`/api/batches?batch_size=${this.batchSize}&max_per_university=${this.maxPerUni}`, { cache:'no-store' });
      this.batchData = await r.json();
    },
    copyBatchCommand(n) {
      const cmd = `push batch ${n} to Gmail`;
      navigator.clipboard.writeText(cmd).then(() => {
        this.copyToast = `Copied: "${cmd}" — paste into chat to send`;
        setTimeout(() => { this.copyToast = ''; }, 3000);
      });
    },

    async loadDrafts() {
      const q = this.draftsQ ? '?q='+encodeURIComponent(this.draftsQ) : '';
      const r = await fetch('/api/drafts'+q, { cache: 'no-store' });
      this.drafts = await r.json();
    },
    async openDraftForProfessor(prof) {
      const r = await fetch(`/api/professors/${prof.id}/draft`);
      let draft = await r.json();
      if (!draft) {
        const c = await fetch('/api/drafts', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ professor_id: prof.id, subject: '', body: this.emailTemplate(prof) })
        });
        draft = await c.json();
      }
      this.editingDraft = {
        ...draft,
        professor_name: prof.name,
        professor_university: prof.university,
        professor_email: prof.email,
        professor_status: prof.status,
      };
      this.saveState = '';
      this.editing = null;
    },
    async openDraftFromList(d) {
      const r = await fetch(`/api/drafts/${d.id}`, { cache: 'no-store' });
      const fresh = await r.json();
      this.editingDraft = {
        ...fresh,
        professor_name: d.professor_name,
        professor_university: d.professor_university,
        professor_email: d.professor_email,
        professor_status: d.professor_status,
      };
      this.saveState = '';
    },
    emailTemplate(prof) {
      const angle = prof.research_angle || prof.notes || '[research angle here]';
      return `Dear Prof. ${prof.name.split(' ').slice(-1)[0]},

I'm Amir Moradi, finishing my PhD at [institution]. I'm reaching out about postdoc opportunities in your group at ${prof.university}${prof.dept_lab ? ' ('+prof.dept_lab+')' : ''}.

My work focuses on [brief one-liner]. Your work on ${angle} overlaps directly with what I want to build next — specifically [one concrete connection].

Two papers from my PhD are currently under review, and I've built a large-scale Montreal urban driving dataset (not yet public) that could be useful for [specific project].

My CV is attached. Would you have 15 minutes in the coming weeks to discuss whether there's a fit?

Best regards,
Amir Moradi`;
    },
    scheduleDraftSave() {
      if (!this.editingDraft?.id) return;
      this.saveState = 'saving…';
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.saveDraft(), 700);
    },
    async saveDraft() {
      if (!this.editingDraft?.id) return;
      const r = await fetch(`/api/drafts/${this.editingDraft.id}`, {
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ subject: this.editingDraft.subject, body: this.editingDraft.body })
      });
      if (r.ok) {
        this.saveState = 'saved ✓';
        await this.loadDrafts();
        setTimeout(() => { if (this.saveState === 'saved ✓') this.saveState = ''; }, 1500);
      } else {
        this.saveState = 'save failed';
      }
    },
    async deleteDraft() {
      if (!this.editingDraft?.id) return;
      if (!confirm('Delete this draft? The professor entry stays.')) return;
      await fetch(`/api/drafts/${this.editingDraft.id}`, { method:'DELETE' });
      this.editingDraft = null;
      await this.loadDrafts();
    },
    async markDraftSent() {
      if (!this.editingDraft?.id) return;
      if (!confirm(`Mark this application as sent today? That will update ${this.editingDraft.professor_name}'s status to "Sent".`)) return;
      await fetch(`/api/drafts/${this.editingDraft.id}/mark_sent`, { method:'POST' });
      this.editingDraft = null;
      await Promise.all([this.load(), this.loadActivity(), this.loadStats(), this.loadDrafts()]);
    },
    copyDraft() {
      const text = `Subject: ${this.editingDraft.subject}\n\n${this.editingDraft.body}`;
      navigator.clipboard.writeText(text).then(() => {
        this.saveState = 'copied to clipboard ✓';
        setTimeout(() => { this.saveState = ''; }, 1800);
      });
    },
    mailtoLink(d) {
      const to = d.professor_email || '';
      const params = new URLSearchParams();
      if (d.subject) params.set('subject', d.subject);
      if (d.body) params.set('body', d.body);
      return `mailto:${to}?${params.toString()}`;
    },
    draftPreview(body) {
      return (body || '').split('\n').slice(0, 2).join(' ').slice(0, 120);
    },

    async load() {
      const q = new URLSearchParams();
      for (const [k,v] of Object.entries(this.filters)) if (v && k !== 'category') q.set(k,v);
      const r = await fetch('/api/professors?'+q.toString());
      this.professors = await r.json();
      if (this.view === 'overview') this.loadStats();
    },
    get displayedProfessors() {
      let list = this.professors;
      if (this.filters.category) list = list.filter(p => p.research_category === this.filters.category);
      if (this.filters.missingEmail) list = list.filter(p => !p.email);
      return list;
    },
    get displayedDrafts() {
      if (!this.draftsCategory) return this.drafts;
      return this.drafts.filter(d => d.professor_research_category === this.draftsCategory);
    },
    draftsCategoryCounts() {
      const out = {};
      for (const k of CATEGORY_KEYS) out[k] = 0;
      for (const d of this.drafts) {
        const c = d.professor_research_category || 'theory';
        out[c] = (out[c] || 0) + 1;
      }
      return out;
    },
    async loadFellowships() {
      const r = await fetch('/api/fellowships'); this.fellowships = await r.json();
    },
    async loadActivity() {
      const r = await fetch('/api/activity?limit=200'); this.activity = await r.json();
    },
    async loadStats() {
      const r = await fetch('/api/stats'); this.stats = await r.json();
    },

    get kpis() {
      const s = this.stats;
      return [
        { label:'Total',         value:s.total,                sub:`T1 ${s.by_tier?.T1||0} · T2 ${s.by_tier?.T2||0} · T3 ${s.by_tier?.T3||0}`, bg:'bg-brand-500' },
        { label:'Drafts',        value:this.drafts.length,     sub:'emails in progress',         bg:'bg-indigo-500' },
        { label:'Sent',          value:s.sent_count,           sub:`of ${s.total} applications`, bg:'bg-sky-500' },
        { label:'Replied',       value:s.reply_count,          sub:'responses received',         bg:'bg-cyan-500' },
        { label:'Response rate', value:(s.response_rate||0)+'%', sub:'of sent emails',           bg:'bg-emerald-500' },
        { label:'Interviews',    value:s.interview_count,      sub:'active conversations',       bg:'bg-amber-500' },
      ];
    },
    get followups() {
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 14);
      return this.professors.filter(p => p.status === 'sent' && p.date_sent && new Date(p.date_sent) <= cutoff);
    },
    get universityList() {
      return [...new Set(this.professors.map(p => p.university).filter(Boolean))].sort();
    },

    professorsByStatus(status) { return this.professors.filter(p => p.status === status); },
    statusName(s)  { return STATUS_NAMES[s] || s; },
    statusEmoji(s) { return STATUS_EMOJI[s] || ''; },
    statusBar(s)   { return STATUS_BAR[s] || 'bg-slate-400'; },
    statusPill(s)  { return STATUS_PILL[s] || 'bg-slate-100 text-slate-700 border border-slate-200'; },
    tierPill(t)    { return TIER_PILL[t] || 'bg-slate-100 text-slate-600'; },
    tierBar(t)     { return TIER_BAR[t]  || 'bg-slate-400'; },
    tierLabel(t)   { return TIER_LABEL[t] || ''; },
    fellowshipPill(s) { return FELLOWSHIP_PILL[s] || 'bg-slate-100 text-slate-600 border border-slate-200'; },
    categoryLabel(c) { return CATEGORY_LABEL[c] || 'Uncategorized'; },
    categoryRow(c)   { return CATEGORY_ROW[c] || 'border-l-4 border-line'; },
    categoryDot(c)   { return CATEGORY_DOT[c] || 'bg-slate-300'; },
    categoryKeys: CATEGORY_KEYS,
    categoryCounts() {
      const out = {};
      for (const k of CATEGORY_KEYS) out[k] = 0;
      for (const p of this.professors) {
        const c = p.research_category || 'theory';
        out[c] = (out[c] || 0) + 1;
      }
      return out;
    },

    daysSince(d) {
      if (!d) return '—';
      return Math.floor((new Date() - new Date(d))/(1000*60*60*24));
    },

    openEdit(p) { this.editing = { ...p }; },
    openCreate() {
      const maxNum = Math.max(0, ...this.professors.map(p => p.number||0));
      this.editing = { number: maxNum+1, name:'', university:'', dept_lab:'', tier:'T2', status:'drafting', date_sent:null, email:'', research_angle:'', notes:'' };
    },
    async save() {
      if (!this.editing.name) { alert('Name is required'); return; }
      const payload = { ...this.editing };
      if (payload.date_sent === '') payload.date_sent = null;
      const url = this.editing.id ? `/api/professors/${this.editing.id}` : '/api/professors';
      const method = this.editing.id ? 'PATCH' : 'POST';
      const r = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      if (r.ok) {
        this.editing = null;
        await Promise.all([this.load(), this.loadActivity(), this.loadStats()]);
      } else {
        alert('Save failed: '+await r.text());
      }
    },
    async del(p) {
      if (!confirm(`Delete ${p.name}? This can't be undone.`)) return;
      const r = await fetch(`/api/professors/${p.id}`, { method:'DELETE' });
      if (r.ok) await Promise.all([this.load(), this.loadActivity(), this.loadStats()]);
    },

    openFellowshipEdit(f) { this.editingFellowship = { ...f }; },
    openFellowshipCreate() {
      this.editingFellowship = { name:'', deadline:'', amount:'', eligibility:'', status:'pending', notes:'', url:'' };
    },
    async saveFellowship() {
      if (!this.editingFellowship.name) { alert('Name is required'); return; }
      const payload = { ...this.editingFellowship };
      const url = this.editingFellowship.id ? `/api/fellowships/${this.editingFellowship.id}` : '/api/fellowships';
      const method = this.editingFellowship.id ? 'PATCH' : 'POST';
      const r = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      if (r.ok) { this.editingFellowship = null; await this.loadFellowships(); }
    },
    async delFellowship() {
      if (!confirm('Delete fellowship?')) return;
      const r = await fetch(`/api/fellowships/${this.editingFellowship.id}`, { method:'DELETE' });
      if (r.ok) { this.editingFellowship = null; await this.loadFellowships(); }
    },
  };
}
