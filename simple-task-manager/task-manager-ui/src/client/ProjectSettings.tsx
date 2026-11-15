import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Check, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Contract, Project, RepoEntry } from '@/types/task';
import { PROJECT_DESCRIPTION_MAX } from './ProjectDialog';
import { useRepos, type ContractBody, type RepoBody } from './useRepos';

const INPUT = 'w-full bg-background border border-border px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary disabled:opacity-60 [&:user-invalid]:border-destructive';
const LABEL = 'text-xs tracking-widest text-muted-foreground uppercase';
const TH = 'px-4 py-2 text-left text-2xs tracking-widest uppercase text-muted-foreground font-normal border-b border-border whitespace-nowrap';
const TD = 'px-4 py-3 text-sm text-foreground align-top border-b border-border/50 group-last:border-b-0';
const CHIP = 'inline-block bg-background border border-border px-1.5 py-0.5 text-xs text-foreground [overflow-wrap:anywhere]';
const NAME_MAX = 64;

type ProjectSettingsValue = { name: string; trackPrs: boolean; description: string };

type Props = {
  project: Pick<Project, 'id' | 'name' | 'trackPrs' | 'description'>;
  // Resolves false when saving failed (the caller has already toasted).
  onSave: (settings: ProjectSettingsValue) => Promise<boolean>;
  // Changes whenever task data refetches; reloads the registry after any write.
  version: unknown;
  onBack: () => void;
};

function reason(err: unknown): string {
  return err instanceof Error && /^Validation failed/.test(err.message) ? ` ${err.message}` : '';
}

export function ProjectSettings({ project, version, onSave, onBack }: Props) {
  const { repos, contracts, setRepo, deleteRepo, setContract, deleteContract } = useRepos(project.id, version);
  // 'new' = create; an entry = edit it.
  const [repoForm, setRepoForm] = useState<'new' | RepoEntry | null>(null);
  const [contractForm, setContractForm] = useState<'new' | Contract | null>(null);

  async function run(action: () => Promise<void>, failure: string): Promise<boolean> {
    try {
      await action();
      return true;
    } catch (err) {
      toast.error(`${failure}${reason(err)}`);
      return false;
    }
  }

  async function removeRepo(r: RepoEntry) {
    if (!window.confirm(`Delete repo "${r.id}"?`)) return;
    await run(() => deleteRepo(r.id), `Failed to delete repo ${r.id}.`);
  }

  async function removeContract(c: Contract) {
    if (!window.confirm(`Delete contract "${c.name}"?`)) return;
    await run(() => deleteContract(c.name), `Failed to delete contract ${c.name}.`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 min-w-0">
        <Button size="sm" variant="outline" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" strokeWidth={1.5} aria-hidden="true" />
          Tasks
        </Button>
        <h1 className="text-sm tracking-widest uppercase min-w-0 [overflow-wrap:anywhere]">
          <span className="text-muted-foreground">Settings / </span>
          <span className="text-primary">{project.name}</span>
        </h1>
      </div>

      <ProjectSection project={project} onSave={onSave} />

      <Section
        id="repos"
        title="Repos"
        description={<>Sibling folders an agent resolves as <code>../&lt;folder&gt;</code>, with their build and test commands. Agents read these instead of each repo's CLAUDE.md.</>}
        action={repos.length > 0 && <Button size="sm" variant="outline" onClick={() => setRepoForm('new')}>Add repo</Button>}
      >
        {repos.length === 0 ? (
          <EmptyState
            title="No repos registered"
            body="Without repos this project shows no repo badges, filters or form fields. Register one per sibling folder."
            action={<Button size="sm" onClick={() => setRepoForm('new')}>Add repo</Button>}
          />
        ) : (
          <>
          <RepoCards repos={repos} onEdit={setRepoForm} onDelete={removeRepo} />
          <div tabIndex={0} role="region" aria-labelledby="repos-heading" className="hidden md:block overflow-x-auto">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className={TH}>Repo</th>
                  <th className={TH}>Folder</th>
                  <th className={TH}>Role</th>
                  <th className={TH}>Commands</th>
                  <th className={TH}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {repos.map((r) => (
                  <tr key={r.id} className="group">
                    <th scope="row" className={`${TD} text-left font-normal whitespace-nowrap`}>
                      <span className="text-primary">{r.id}</span>
                      {r.name !== r.id && <span className="block text-xs text-muted-foreground">{r.name}</span>}
                    </th>
                    <td className={TD}>
                      <code className="whitespace-nowrap">../{r.folder}</code>
                      {r.rulesFile !== 'CLAUDE.md' && <span className="block text-xs text-muted-foreground whitespace-nowrap">rules: {r.rulesFile}</span>}
                    </td>
                    <td className={`${TD} min-w-[12rem]`}>{r.role || <span className="text-muted-foreground">—</span>}</td>
                    <td className={TD}>
                      <CommandList commands={r.commands} />
                    </td>
                    <td className={`${TD} w-px whitespace-nowrap text-right`}>
                      <RowActions label={`repo ${r.id}`} onEdit={() => setRepoForm(r)} onDelete={() => removeRepo(r)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Section>

      <Section
        id="contracts"
        title="Contracts"
        description="What one repo owns and others consume, such as a protocol spec or an API. A change starts in the owner, then gets a follow-up in every consumer."
        action={contracts.length > 0 && <Button size="sm" variant="outline" onClick={() => setContractForm('new')}>Add contract</Button>}
      >
        {contracts.length === 0 ? (
          repos.length < 2 ? (
            <EmptyState title="No contracts" body="A contract links an owner repo to the repos that consume it. Register at least two repos first." />
          ) : (
            <EmptyState
              title="No contracts"
              body="Add one where a change in one repo needs follow-ups in others."
              action={<Button size="sm" onClick={() => setContractForm('new')}>Add contract</Button>}
            />
          )
        ) : (
          <>
          <ContractCards contracts={contracts} onEdit={setContractForm} onDelete={removeContract} />
          <div tabIndex={0} role="region" aria-labelledby="contracts-heading" className="hidden md:block overflow-x-auto">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className={TH}>Contract</th>
                  <th className={TH}>Owner → consumers</th>
                  <th className={TH}>Source</th>
                  <th className={TH}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.name} className="group">
                    <th scope="row" className={`${TD} text-left font-normal min-w-[14rem]`}>
                      <span className="text-primary">{c.name}</span>
                      {c.rule && <span className="block text-xs text-muted-foreground">{c.rule}</span>}
                    </th>
                    <td className={`${TD} whitespace-nowrap`}>
                      {c.owner}
                      <span className="text-muted-foreground"> → </span>
                      {c.consumers.length > 0 ? c.consumers.join(', ') : <span className="text-muted-foreground">none</span>}
                    </td>
                    <td className={TD}>{c.source ? <code className={CHIP}>{c.source}</code> : <span className="text-muted-foreground">—</span>}</td>
                    <td className={`${TD} w-px whitespace-nowrap text-right`}>
                      <RowActions label={`contract ${c.name}`} onEdit={() => setContractForm(c)} onDelete={() => removeContract(c)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Section>

      <RepoDialog
        key={repoForm === null ? 'closed' : repoForm === 'new' ? 'new' : repoForm.id}
        open={repoForm !== null}
        initial={repoForm === 'new' ? undefined : repoForm ?? undefined}
        onOpenChange={(open) => { if (!open) setRepoForm(null); }}
        onSubmit={(id, body) => run(() => setRepo(id, body), `Failed to save repo ${id}.`)}
      />
      <ContractDialog
        key={contractForm === null ? 'closed' : contractForm === 'new' ? 'new' : contractForm.name}
        open={contractForm !== null}
        initial={contractForm === 'new' ? undefined : contractForm ?? undefined}
        repoIds={repos.map((r) => r.id)}
        onOpenChange={(open) => { if (!open) setContractForm(null); }}
        onSubmit={(name, body) => run(() => setContract(name, body), `Failed to save contract ${name}.`)}
      />
    </div>
  );
}

function Section({ id, title, description, action, status, children }: {
  id: string;
  title: string;
  description: ReactNode;
  action?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="min-w-0 border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 py-4 border-b border-border">
        <div className="flex flex-col gap-1 min-w-0 flex-1 basis-80">
          <div className="flex items-center gap-3">
            <h2 id={`${id}-heading`} className="text-sm tracking-widest text-primary uppercase">{title}</h2>
            {status}
          </div>
          <p className="text-xs text-muted-foreground max-w-prose [text-wrap:pretty]">{description}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="m-4 flex flex-col items-center gap-3 border border-dashed border-border px-4 py-8 text-center">
      <p className="text-sm text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground max-w-md [text-wrap:pretty]">{body}</p>
      {action}
    </div>
  );
}

// Below md the tables would scroll sideways on a phone; each entry becomes a card instead.
function RepoCards({ repos, onEdit, onDelete }: { repos: RepoEntry[]; onEdit: (r: RepoEntry) => void; onDelete: (r: RepoEntry) => void }) {
  return (
    <ul className="md:hidden">
      {repos.map((r) => (
        <li key={r.id} className="flex flex-col gap-3 px-4 py-4 border-b border-border/50 last:border-b-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="text-primary">{r.id}</span>
              {r.name !== r.id && <span className="block text-xs text-muted-foreground">{r.name}</span>}
            </div>
            <RowActions label={`repo ${r.id}`} onEdit={() => onEdit(r)} onDelete={() => onDelete(r)} />
          </div>
          <CardFields fields={[
            ['Folder', <code key="f" className="[overflow-wrap:anywhere]">../{r.folder}</code>],
            ['Role', r.role || null],
            ['Commands', <CommandList key="c" commands={r.commands} />],
            ['Rules', r.rulesFile !== 'CLAUDE.md' ? r.rulesFile : null],
          ]} />
        </li>
      ))}
    </ul>
  );
}

function ContractCards({ contracts, onEdit, onDelete }: { contracts: Contract[]; onEdit: (c: Contract) => void; onDelete: (c: Contract) => void }) {
  return (
    <ul className="md:hidden">
      {contracts.map((c) => (
        <li key={c.name} className="flex flex-col gap-3 px-4 py-4 border-b border-border/50 last:border-b-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="text-primary">{c.name}</span>
              {c.rule && <span className="block text-xs text-muted-foreground">{c.rule}</span>}
            </div>
            <RowActions label={`contract ${c.name}`} onEdit={() => onEdit(c)} onDelete={() => onDelete(c)} />
          </div>
          <CardFields fields={[
            ['Owner', c.owner],
            ['Consumers', c.consumers.length > 0 ? c.consumers.join(', ') : null],
            ['Source', c.source ? <code key="s" className={CHIP}>{c.source}</code> : null],
          ]} />
        </li>
      ))}
    </ul>
  );
}

function CardFields({ fields }: { fields: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 text-sm text-foreground">
      {fields.filter(([, v]) => v !== null).map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-2xs tracking-widest uppercase text-muted-foreground">{label}</dt>
          <dd className="min-w-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CommandList({ commands }: { commands: RepoEntry['commands'] }) {
  const set = (['build', 'test', 'lint'] as const).filter((k) => commands[k]);
  if (set.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1">
      {set.map((k) => (
        <div key={k} className="contents">
          <dt className="text-2xs tracking-widest uppercase text-muted-foreground">{k}</dt>
          <dd className="min-w-0"><code className={CHIP}>{commands[k]}</code></dd>
        </div>
      ))}
    </dl>
  );
}

function RowActions({ label, onEdit, onDelete }: { label: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" className="px-2" onClick={onEdit} aria-label={`Edit ${label}`} title="Edit">
        <Pencil className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
      </Button>
      <Button size="sm" variant="ghost" className="px-2 hover:text-destructive" onClick={onDelete} aria-label={`Delete ${label}`} title="Delete">
        <Trash2 className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
      </Button>
    </div>
  );
}

// One settings row: label and hint on the left, the control on the right; stacks on narrow screens.
function Row({ label, hint, htmlFor, hintId, children }: {
  label: string;
  hint: ReactNode;
  htmlFor?: string;
  hintId: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-x-8 gap-y-2 px-4 py-4 border-b border-border/50 last:border-b-0 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        {htmlFor ? <label htmlFor={htmlFor} className={LABEL}>{label}</label> : <span className={LABEL}>{label}</span>}
        <p id={hintId} className="text-xs text-muted-foreground [text-wrap:pretty]">{hint}</p>
      </div>
      <div className="min-w-0 max-w-2xl">{children}</div>
    </div>
  );
}

type SaveState = 'idle' | 'saving' | 'saved';

// Fields save on their own: text when the field is left (Enter in the name, too), the
// checkbox on toggle. Escape reverts a text field. A failed save reverts to the stored value.
function ProjectSection({ project, onSave }: Pick<Props, 'project' | 'onSave'>) {
  const uid = useId();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [trackPrs, setTrackPrs] = useState(project.trackPrs);
  const [state, setState] = useState<SaveState>('idle');
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  async function commit(patch: Partial<ProjectSettingsValue>) {
    const next: ProjectSettingsValue = {
      name: (patch.name ?? name).trim(),
      description: (patch.description ?? description).trim(),
      trackPrs: patch.trackPrs ?? trackPrs,
    };
    if (!next.name) return;
    if (next.name === project.name && next.description === project.description && next.trackPrs === project.trackPrs) return;
    clearTimeout(savedTimer.current);
    setState('saving');
    if (await onSave(next)) {
      setName(next.name);
      setDescription(next.description);
      setState('saved');
      savedTimer.current = setTimeout(() => setState('idle'), 2000);
    } else {
      setName(project.name);
      setDescription(project.description);
      setTrackPrs(project.trackPrs);
      setState('idle');
    }
  }

  const status = (
    <span role="status" className="flex items-center gap-1 text-2xs tracking-widest uppercase text-muted-foreground">
      {state === 'saving' && 'Saving…'}
      {state === 'saved' && <><Check className="w-3 h-3 text-success" strokeWidth={2} aria-hidden="true" />Saved</>}
    </span>
  );

  return (
    <Section id="project" title="Project" description="Changes save as you go." status={status}>
      <Row label="Name" htmlFor={`${uid}-name`} hintId={`${uid}-name-hint`} hint="Shown in the project tabs and the switcher.">
        <input
          id={`${uid}-name`}
          name="name"
          required
          maxLength={NAME_MAX}
          value={name}
          aria-describedby={`${uid}-name-hint${name.trim() ? '' : ` ${uid}-name-error`}`}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void commit({ name })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setName(project.name);
          }}
          className={INPUT}
        />
        {!name.trim() && <p id={`${uid}-name-error`} className="mt-1 text-xs text-destructive">Error: a project needs a name. Not saved.</p>}
      </Row>
      <Row
        label="Description"
        htmlFor={`${uid}-description`}
        hintId={`${uid}-description-hint`}
        hint="What this project covers, so agents can tell projects apart."
      >
        <textarea
          id={`${uid}-description`}
          name="description"
          rows={3}
          maxLength={PROJECT_DESCRIPTION_MAX}
          value={description}
          aria-describedby={`${uid}-description-hint`}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => void commit({ description })}
          onKeyDown={(e) => { if (e.key === 'Escape') setDescription(project.description); }}
          className={`${INPUT} resize-y`}
        />
        <p className="mt-1 text-right text-xs text-muted-foreground tabular-nums">{description.length}/{PROJECT_DESCRIPTION_MAX}</p>
      </Row>
      <Row label="Track PRs" hintId={`${uid}-prs-hint`} hint="Agents record the PRs/MRs they open on the task, from their next session.">
        <label className="inline-flex min-h-6 items-center gap-2 text-sm text-foreground cursor-pointer">
          <input
            type="checkbox"
            name="trackPrs"
            checked={trackPrs}
            aria-describedby={`${uid}-prs-hint`}
            onChange={(e) => {
              setTrackPrs(e.target.checked);
              void commit({ trackPrs: e.target.checked });
            }}
            className="w-4 h-4 accent-primary"
          />
          {trackPrs ? 'On' : 'Off'}
        </label>
      </Row>
      <Row label="Project id" hintId={`${uid}-id-hint`} hint="Fixed: PROJECT_NAME, API keys and URLs use it. Renaming the project doesn't change it.">
        <code className={CHIP}>{project.id}</code>
      </Row>
    </Section>
  );
}

function RepoDialog({ open, initial, onOpenChange, onSubmit }: {
  open: boolean;
  initial?: RepoEntry;
  onOpenChange: (open: boolean) => void;
  onSubmit: (id: string, body: RepoBody) => Promise<boolean>;
}) {
  const editing = initial !== undefined;
  const [id, setId] = useState(initial?.id ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [folder, setFolder] = useState(initial?.folder ?? '');
  const [role, setRole] = useState(initial?.role ?? '');
  const [build, setBuild] = useState(initial?.commands.build ?? '');
  const [test, setTest] = useState(initial?.commands.test ?? '');
  const [lint, setLint] = useState(initial?.commands.lint ?? '');
  const [rulesFile, setRulesFile] = useState(initial?.rulesFile ?? 'CLAUDE.md');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      // On edit '' removes a stored command; on create only filled ones are sent.
      const commands = Object.fromEntries(
        Object.entries({ build, test, lint }).map(([k, v]) => [k, v.trim()]).filter(([, v]) => editing || v),
      );
      const body: RepoBody = {
        folder: folder.trim(),
        role: role.trim(),
        commands,
        ...(name.trim() && { name: name.trim() }),
        ...(rulesFile.trim() && { rulesFile: rulesFile.trim() }),
      };
      if (await onSubmit(id.trim(), body)) onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-[520px] flex flex-col max-h-[calc(100dvh-2rem)]">
        <DialogHeader>
          <DialogTitle className="text-primary text-sm tracking-widest uppercase">{editing ? 'Edit Repo' : 'New Repo'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4 min-h-0">
          <div className="flex flex-col gap-4 min-h-0 overflow-y-auto">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Id</span>
              <input
                required
                autoFocus={!editing}
                disabled={editing}
                maxLength={64}
                pattern="[a-z0-9][a-z0-9\-]*"
                title="Lowercase letters, digits and dashes"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="e.g. firmware"
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Name</span>
              <input maxLength={280} value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to the id" className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Folder</span>
              <input
                required
                maxLength={280}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="Sibling directory name, no path"
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Role</span>
              <input maxLength={280} value={role} onChange={(e) => setRole(e.target.value)} placeholder="One line: what this repo is" className={INPUT} />
            </label>
            <fieldset className="flex flex-col gap-3">
              <legend className={`${LABEL} mb-1`}>Commands</legend>
              {([['Build', build, setBuild], ['Test', test, setTest], ['Lint', lint, setLint]] as const).map(([label, value, setValue]) => (
                <label key={label} className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <input
                    maxLength={280}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className={INPUT}
                  />
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Rules file</span>
              <input maxLength={280} autoCapitalize="none" spellCheck={false} value={rulesFile} onChange={(e) => setRulesFile(e.target.value)} className={INPUT} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={submitting || !id.trim() || !folder.trim()}>{submitting ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ContractDialog({ open, initial, repoIds, onOpenChange, onSubmit }: {
  open: boolean;
  initial?: Contract;
  repoIds: string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, body: ContractBody) => Promise<boolean>;
}) {
  const editing = initial !== undefined;
  const [name, setName] = useState(initial?.name ?? '');
  const [owner, setOwner] = useState(initial?.owner ?? repoIds[0] ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [consumers, setConsumers] = useState<string[]>(initial?.consumers ?? []);
  const [rule, setRule] = useState(initial?.rule ?? '');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const body: ContractBody = { owner, source: source.trim(), rule: rule.trim(), consumers: consumers.filter((c) => c !== owner) };
      if (await onSubmit(name.trim(), body)) onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-[520px] flex flex-col max-h-[calc(100dvh-2rem)]">
        <DialogHeader>
          <DialogTitle className="text-primary text-sm tracking-widest uppercase">{editing ? 'Edit Contract' : 'New Contract'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4 min-h-0">
          <div className="flex flex-col gap-4 min-h-0 overflow-y-auto">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Name</span>
              <input
                required
                autoFocus={!editing}
                disabled={editing}
                maxLength={280}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sync protocol v1"
                className={INPUT}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Owner</span>
              <select
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                className="bg-background border border-border px-2 h-9 text-base text-foreground focus:outline-none focus:border-primary"
              >
                {repoIds.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Source</span>
              <input
                maxLength={280}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="Glob in the owner repo, e.g. docs/spec/*.yaml"
                className={INPUT}
              />
            </label>
            <fieldset className="flex flex-col gap-1">
              <legend className={`${LABEL} mb-1`}>Consumers</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {repoIds.filter((id) => id !== owner).map((id) => (
                  <label key={id} className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={consumers.includes(id)}
                      onChange={(e) => setConsumers((c) => (e.target.checked ? [...c, id] : c.filter((x) => x !== id)))}
                      className="accent-primary"
                    />
                    {id}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Rule</span>
              <input
                maxLength={280}
                value={rule}
                onChange={(e) => setRule(e.target.value)}
                placeholder="One line, e.g. change the source first, then every consumer"
                className={INPUT}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={submitting || !name.trim() || !owner}>{submitting ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
