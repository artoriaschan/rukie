import { Value } from "typebox/value";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Ellipsis, Plus, Server } from "lucide-react";
import {
  THINKING_LEVELS,
  parseModelServiceSave,
  ModelCompatSchemas,
  type ModelService,
  type ModelServiceSummary,
} from "@rukie/shared";
import type { DesktopHost } from "../host";
import { Button } from "../components/motion/button/base";
import { Input } from "../components/motion/input";
import { Checkbox } from "../components/motion/checkbox";
import { Select, SelectTrigger, SelectContent, SelectItem } from "../components/motion/select";
import { MorphingModal } from "../components/motion/morphing-modal";
import * as Menu from "../components/ui/dropdown-menu";
import { useAppText } from "../lib/i18n";

type Services = NonNullable<DesktopHost["modelServices"]>;
type ServiceModel = ModelService["models"][number];
const routes = {
  "anthropic-messages": "/v1/messages",
  "openai-completions": "/chat/completions",
  "openai-responses": "/responses",
};
const protocols = {
  "anthropic-messages": "Anthropic Messages",
  "openai-completions": "Chat Completions",
  "openai-responses": "Responses",
};
const defaultModel: ServiceModel = {
  id: "",
  input: ["text"],
  reasoning: false,
  contextWindow: 128000,
  maxTokens: 16384,
};

/** Settings owns drafts; the trusted host owns secret storage and connection checks. */
export function ModelServices({
  services,
  onClose,
  onChanged,
}: {
  services: Services;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useAppText();
  const surface = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    surface.current?.querySelector<HTMLElement>("button")?.focus();
    return () => previous?.focus();
  }, []);
  const [providers, setProviders] = useState<ModelServiceSummary[]>([]);
  const [templates, setTemplates] = useState<ModelService[]>([]);
  const [draft, setDraft] = useState<ModelService>();
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [catalog, setCatalog] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState<"model" | "rename" | "delete" | null>(null);
  const [editing, setEditing] = useState<number>();
  const [model, setModel] = useState<ServiceModel>(defaultModel);
  const [intelligent, setIntelligent] = useState(false);
  const [modelError, setModelError] = useState("");
  const [modelNotice, setModelNotice] = useState("");
  const [rename, setRename] = useState("");
  const selected = providers.find((provider) => provider.id === draft?.id);
  const choose = (provider: ModelService) => {
    setDraft(
      structuredClone({
        id: provider.id,
        name: provider.name,
        api: provider.api,
        baseUrl: provider.baseUrl,
        models: provider.models,
      }),
    );
    setKey("");
    setRemoveKey(false);
    setError("");
    setStatus("");
    setCatalog(false);
  };
  const load = async () => {
    try {
      const result = await services.list();
      setProviders(result);
      if (!draft && result[0]) choose(result[0]);
      if (services.templates) setTemplates(await services.templates());
      setError("");
    } catch {
      setError(t("services.loadFailure"));
    }
  };
  useEffect(() => {
    void load();
  }, [services]);
  const persist = async (provider: ModelService) => {
    if (pending) return false;
    const credential = removeKey
      ? { type: "delete" as const }
      : key.trim()
        ? { type: "replace" as const, value: key }
        : { type: "keep" as const };
    const parsed = parseModelServiceSave({ provider, credential });
    let validUrl = false;
    try {
      const url = new URL(provider.baseUrl);
      validUrl = ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch {
      /* invalid user input */
    }
    if (
      provider.models.some(
        (item) =>
          item.compat !== undefined && !Value.Check(ModelCompatSchemas[provider.api], item.compat),
      )
    ) {
      setError(t("services.apiIncompatible"));
      return false;
    }
    if (
      !parsed ||
      !provider.name.trim() ||
      !validUrl ||
      new Set(provider.models.map((m) => m.id)).size !== provider.models.length
    ) {
      setError(t("services.invalid"));
      return false;
    }
    setPending(true);
    setError("");
    setStatus("");
    try {
      await services.save(parsed);
      const hasCredential =
        credential.type === "replace" ||
        (credential.type === "keep" && Boolean(selected?.hasCredential));
      setProviders((previous) => [
        ...previous.filter((item) => item.id !== provider.id),
        { ...provider, hasCredential },
      ]);
      setDraft(
        structuredClone({
          id: provider.id,
          name: provider.name,
          api: provider.api,
          baseUrl: provider.baseUrl,
          models: provider.models,
        }),
      );
      setKey("");
      setRemoveKey(false);
      try {
        setProviders(await services.list());
        await onChanged();
      } catch {
        setError(t("services.refreshFailure"));
      }
      setStatus(t("services.saved"));
      return true;
    } catch {
      setError(t("services.saveFailure"));
      return false;
    } finally {
      setPending(false);
    }
  };
  const create = (template?: ModelService) => {
    choose({
      id: `provider-${crypto.randomUUID()}`,
      name: template?.name ?? t("services.new"),
      api: template?.api ?? "anthropic-messages",
      baseUrl: template?.baseUrl ?? "",
      models: [],
    });
  };
  const openModel = (index?: number) => {
    setEditing(index);
    setModel(structuredClone(index === undefined ? defaultModel : draft!.models[index]!));
    setModelError("");
    setModelNotice("");
    setIntelligent(false);
    setDialog("model");
  };
  const applyTemplate = (id: string) => {
    const template = templates
      .filter((p) => p.api === draft?.api)
      .flatMap((p) => p.models)
      .find((m) => m.id === id);
    if (template) {
      setModel({ ...structuredClone(template), enabled: model.enabled });
      setModelNotice(t("services.templateNote"));
    } else {
      setModel((previous) => ({ ...previous, id }));
      setModelNotice(t("services.noTemplate"));
    }
  };
  const saveModel = async () => {
    if (!draft || !model.id.trim() || !model.contextWindow || !model.maxTokens) {
      setModelError(t("services.invalid"));
      return;
    }
    const models = [...draft.models];
    if (editing === undefined) models.push(model);
    else models[editing] = model;
    if (await persist({ ...draft, models })) setDialog(null);
    else setModelError(t("services.saveFailure"));
  };
  const testConnection = async (modelId: string) => {
    if (!services.test || !draft || pending) return;
    if (!(await persist(draft))) return;
    setPending(true);
    setStatus(t("services.testing"));
    try {
      await services.test(draft.id, modelId);
      setStatus(t("services.testSuccess"));
    } catch {
      setStatus("");
      setError(t("services.testFailure"));
    } finally {
      setPending(false);
    }
  };
  const updateMap = (level: (typeof THINKING_LEVELS)[number], value: string | null) =>
    setModel((previous) => ({
      ...previous,
      thinkingLevelMap: { ...previous.thinkingLevelMap, [level]: value },
    }));
  return (
    <section
      ref={surface}
      aria-label={t("services.title")}
      className="fixed inset-x-0 bottom-0 top-11 z-30 flex min-h-0 bg-background text-foreground text-ui-base"
    >
      <aside className="flex w-40 shrink-0 flex-col gap-3 border-r border-border bg-sidebar p-3 max-sm:w-28">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="size-4" />
          {t("services.back")}
        </Button>
        <Button variant="secondary" size="sm">
          <Server className="size-4" />
          {t("services.title")}
        </Button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border p-4">
          <h1 className="text-ui-lg font-semibold">{t("services.title")}</h1>
          <p className="text-ui-sm text-muted-foreground">{t("services.description")}</p>
        </div>
        <div className="flex min-h-0 flex-1 max-sm:flex-col">
          <aside
            aria-label={t("services.custom")}
            className="flex w-48 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border p-3 max-sm:max-h-36 max-sm:w-full max-sm:border-r-0 max-sm:border-b"
          >
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setCatalog(true);
                setError("");
              }}
            >
              <Plus className="size-4" />
              {t("services.addProvider")}
            </Button>
            <p className="text-ui-xs text-muted-foreground">{t("services.custom")}</p>
            {[
              ...providers,
              ...(draft && !selected ? [{ ...draft, hasCredential: false }] : []),
            ].map((provider) => (
              <Button
                key={provider.id}
                variant={draft?.id === provider.id ? "secondary" : "ghost"}
                size="sm"
                className="justify-start truncate"
                aria-pressed={draft?.id === provider.id}
                disabled={pending}
                onClick={() => choose(provider)}
              >
                {provider.name}
              </Button>
            ))}
          </aside>
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {error ? (
              <div className="mb-3 text-ui-sm text-danger">
                <p role="alert">{error}</p>
                {error === t("services.loadFailure") ? (
                  <Button variant="ghost" size="sm" onClick={() => void load()}>
                    {t("services.retry")}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {status ? (
              <p role="status" className="mb-3 text-ui-sm">
                {status}
              </p>
            ) : null}
            {catalog ? (
              <div className="flex max-w-xl flex-col gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => setCatalog(false)}
                >
                  <ArrowLeft className="size-4" />
                  {t("services.returnDetail")}
                </Button>
                <h2 className="font-medium">{t("services.catalog")}</h2>
                <p className="text-ui-sm text-muted-foreground">{t("services.templateSource")}</p>
                {templates.map((template) => (
                  <Button
                    key={template.id}
                    variant="secondary"
                    className="justify-start"
                    onClick={() => create(template)}
                  >
                    {template.name}
                  </Button>
                ))}
                <Button variant="secondary" onClick={() => create()}>
                  {t("services.create")}
                </Button>
              </div>
            ) : draft ? (
              <div className="flex max-w-2xl flex-col gap-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="truncate text-ui-lg font-medium">{draft.name}</h2>
                  <Menu.DropdownMenu>
                    <Menu.DropdownMenuTrigger asChild>
                      <Button
                        disabled={pending}
                        aria-label={t("services.actions")}
                        variant="ghost"
                        size="icon"
                      >
                        <Ellipsis className="size-4" />
                      </Button>
                    </Menu.DropdownMenuTrigger>
                    <Menu.DropdownMenuContent align="end">
                      <Menu.DropdownMenuItem
                        onSelect={() => {
                          setRename(draft.name);
                          setDialog("rename");
                        }}
                      >
                        {t("services.rename")}
                      </Menu.DropdownMenuItem>
                      <Menu.DropdownMenuItem onSelect={() => setDialog("delete")}>
                        {t("services.deleteProvider")}
                      </Menu.DropdownMenuItem>
                    </Menu.DropdownMenuContent>
                  </Menu.DropdownMenu>
                </div>
                <Input
                  disabled={pending}
                  label={t("services.name")}
                  value={draft.name}
                  onChange={(name) => setDraft({ ...draft, name })}
                />
                <Input
                  disabled={pending}
                  label={t("services.url")}
                  value={draft.baseUrl}
                  placeholder="https://api.example.com/v1"
                  onChange={(baseUrl) => setDraft({ ...draft, baseUrl })}
                />
                <div className="relative">
                  <p className="mb-1 font-medium">{t("services.api")}</p>
                  <Select
                    value={draft.api}
                    disabled={pending}
                    onValueChange={(api) => {
                      if (
                        api === "anthropic-messages" ||
                        api === "openai-completions" ||
                        api === "openai-responses"
                      )
                        setDraft({ ...draft, api });
                    }}
                  >
                    <SelectTrigger
                      aria-label={t("services.api")}
                    >{`${protocols[draft.api]} (${routes[draft.api]})`}</SelectTrigger>
                    <SelectContent>
                      {Object.entries(protocols).map(([api, label]) => (
                        <SelectItem
                          key={api}
                          value={api}
                        >{`${label} (${routes[api as keyof typeof routes]})`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="break-all text-ui-sm text-muted-foreground">
                  {t("services.route")}: {draft.baseUrl.replace(/\/$/, "")}
                  {routes[draft.api]}
                </p>
                <Input
                  disabled={pending}
                  label={t("services.key")}
                  type="password"
                  autoComplete="off"
                  value={key}
                  placeholder={selected?.hasCredential ? "••••••••••••••••" : t("services.key")}
                  onChange={setKey}
                />
                {selected?.hasCredential ? (
                  <>
                    <p className="text-ui-sm text-muted-foreground">{t("services.keyKeep")}</p>
                    <Checkbox
                      label={t("services.keyDelete")}
                      checked={removeKey}
                      disabled={pending}
                      onCheckedChange={setRemoveKey}
                    />
                  </>
                ) : null}
                <div className="flex gap-2">
                  <Button size="sm" disabled={pending} onClick={() => void persist(draft)}>
                    {t("services.saveProvider")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => (selected ? choose(selected) : setDraft(undefined))}
                  >
                    {t("services.cancel")}
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
                  <h3 className="font-medium">{t("services.models")}</h3>
                  <Button variant="secondary" size="sm" onClick={() => openModel()}>
                    <Plus className="size-4" />
                    {t("services.addModel")}
                  </Button>
                </div>
                {!draft.models.length ? (
                  <p className="text-ui-sm text-muted-foreground">{t("services.empty")}</p>
                ) : (
                  draft.models.map((item, index) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-card-border bg-card p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="break-all font-medium">{item.id}</p>
                        <p className="text-ui-xs text-muted-foreground">
                          {item.contextWindow ?? 128000} ·{" "}
                          {item.input?.includes("image") ? t("services.image") : t("services.text")}
                          {item.reasoning ? ` · ${t("services.reasoning")}` : ""}
                        </p>
                      </div>
                      <Checkbox
                        label={t("services.enabled")}
                        checked={item.enabled !== false}
                        disabled={pending}
                        onCheckedChange={(enabled) =>
                          void persist({
                            ...draft,
                            models: draft.models.map((m, i) =>
                              i === index ? { ...m, enabled } : m,
                            ),
                          })
                        }
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!services.test || pending}
                        onClick={() => void testConnection(item.id)}
                      >
                        {t("services.test")}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openModel(index)}>
                        {t("services.edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() =>
                          void persist({
                            ...draft,
                            models: draft.models.filter((_, i) => i !== index),
                          })
                        }
                      >
                        {t("services.deleteModel")}
                      </Button>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setCatalog(true)}>
                {t("services.addProvider")}
              </Button>
            )}
          </div>
        </div>
      </div>
      <MorphingModal
        label={
          dialog === "model"
            ? t(editing === undefined ? "services.addModel" : "services.editModel")
            : dialog === "rename"
              ? t("services.rename")
              : t("services.deleteTitle", { name: draft?.name ?? "" })
        }
        viewId={dialog}
        onClose={() => {
          if (!pending) setDialog(null);
        }}
        placement="center"
      >
        {dialog === "model" ? (
          <form
            className="flex min-h-0 flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void saveModel();
            }}
          >
            <h2 className="shrink-0 font-medium">
              {t(editing === undefined ? "services.addModel" : "services.editModel")}
            </h2>
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
              <Checkbox
                checked={intelligent}
                label={t("services.intelligent")}
                onCheckedChange={(value) => {
                  setIntelligent(value);
                  if (value) applyTemplate(model.id);
                }}
              />
              <p className="text-ui-xs text-muted-foreground">
                {modelNotice || t("services.templateNote")}
              </p>
              <Input
                label={t("services.id")}
                autoFocus
                value={model.id}
                onChange={(id) => (intelligent ? applyTemplate(id) : setModel({ ...model, id }))}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label={t("services.context")}
                  type="number"
                  min={1}
                  value={String(model.contextWindow ?? "")}
                  onChange={(value) => setModel({ ...model, contextWindow: Number(value) })}
                />
                <Input
                  label={t("services.tokens")}
                  type="number"
                  min={1}
                  value={String(model.maxTokens ?? "")}
                  onChange={(value) => setModel({ ...model, maxTokens: Number(value) })}
                />
              </div>
              <h3 className="font-medium">{t("services.advanced")}</h3>
              <p>{t("services.inputs")}</p>
              <div className="flex flex-wrap gap-3">
                <Checkbox checked disabled label={t("services.text")} onCheckedChange={() => {}} />
                <Checkbox
                  checked={model.input?.includes("image") ?? false}
                  label={t("services.image")}
                  onCheckedChange={(value) =>
                    setModel({ ...model, input: value ? ["text", "image"] : ["text"] })
                  }
                />
                <Checkbox
                  checked={false}
                  disabled
                  label={t("services.video")}
                  onCheckedChange={() => {}}
                />
                <Checkbox
                  checked={false}
                  disabled
                  label={t("services.pdf")}
                  onCheckedChange={() => {}}
                />
              </div>
              <p>{t("services.capabilities")}</p>
              <div className="flex flex-wrap gap-3">
                <Checkbox
                  checked={false}
                  disabled
                  label={t("services.structured")}
                  onCheckedChange={() => {}}
                />
                <Checkbox
                  checked={false}
                  disabled
                  label={t("services.web")}
                  onCheckedChange={() => {}}
                />
                <Checkbox
                  checked={model.compat?.supportsMidConvoSystemMessages ?? false}
                  label={t("services.midSystem")}
                  onCheckedChange={(value) =>
                    setModel({
                      ...model,
                      compat: { ...model.compat, supportsMidConvoSystemMessages: value },
                    })
                  }
                />
              </div>
              <p className="text-ui-xs text-muted-foreground">{t("services.unsupported")}</p>
              <Checkbox
                checked={model.reasoning ?? false}
                label={t("services.reasoning")}
                onCheckedChange={(reasoning) => setModel({ ...model, reasoning })}
              />
              {model.reasoning ? (
                <>
                  <p>{t("services.levels")}</p>
                  {THINKING_LEVELS.map((level) => {
                    const mapped = model.thinkingLevelMap?.[level];
                    const enabled =
                      mapped !== null &&
                      ((level !== "xhigh" && level !== "max") || mapped !== undefined);
                    return (
                      <div key={level} className="flex items-center gap-3">
                        <Checkbox
                          checked={enabled}
                          label={t(`services.${level}`)}
                          onCheckedChange={(value) => updateMap(level, value ? level : null)}
                        />
                        <Input
                          className="min-w-0 flex-1"
                          aria-label={`${t("services.mapping")} ${level}`}
                          disabled={!enabled}
                          value={mapped ?? ""}
                          placeholder={level}
                          onChange={(value) => updateMap(level, value || level)}
                        />
                      </div>
                    );
                  })}
                </>
              ) : null}
              {modelError || error ? (
                <p role="alert" className="text-ui-sm text-danger">
                  {modelError || error}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setModel(structuredClone(defaultModel));
                  setModelError("");
                  setModelNotice("");
                  setIntelligent(false);
                }}
              >
                {t("services.reset")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDialog(null)} disabled={pending}>
                {t("services.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {t("services.saveModel")}
              </Button>
            </div>
          </form>
        ) : dialog === "rename" ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (draft)
                void persist({ ...draft, name: rename }).then((saved) => {
                  if (saved) setDialog(null);
                });
            }}
          >
            <h2 className="font-medium">{t("services.rename")}</h2>
            <Input autoFocus label={t("services.name")} value={rename} onChange={setRename} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialog(null)}>
                {t("services.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {t("services.saveProvider")}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <h2 className="font-medium">
              {t("services.deleteTitle", { name: draft?.name ?? "" })}
            </h2>
            <p className="text-ui-sm text-muted-foreground">{t("services.deleteNote")}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialog(null)} disabled={pending}>
                {t("services.cancel")}
              </Button>
              <Button
                disabled={pending}
                onClick={() => {
                  if (!draft) return;
                  setPending(true);
                  void services
                    .delete(draft.id)
                    .then(async () => {
                      setDialog(null);
                      setDraft(undefined);
                      setProviders(await services.list());
                      try {
                        await onChanged();
                      } catch {
                        setError(t("services.refreshFailure"));
                      }
                      setKey("");
                    })
                    .catch(() => setError(t("services.saveFailure")))
                    .finally(() => setPending(false));
                }}
              >
                {t("services.confirm")}
              </Button>
            </div>
          </div>
        )}
      </MorphingModal>
    </section>
  );
}
