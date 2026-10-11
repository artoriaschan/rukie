import { Value } from "typebox/value";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CornerDownLeft,
  LockKeyhole,
  Ellipsis,
  Plus,
  Server,
  RefreshCw,
  Plug,
  Unplug,
  Pencil,
  Trash2,
  Info,
  X,
  Search,
  Settings,
  Sun,
  CircleUser,
  SlidersHorizontal,
  Brain,
  Keyboard,
  Mic,
  Upload,
  Hand,
  Globe,
  Terminal,
  GitBranch,
  Anchor,
  Puzzle,
  Sparkles,
  Bot,
  Box,
  Circle,
  Zap,
  ChevronRight,
  ChevronDown,
  Eye,
  EyeOff,
} from "lucide-react";
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
import { Tooltip } from "../components/motion/tooltip";
import { Switch } from "../components/motion/switch";
import { Textarea } from "../components/ui/textarea";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource-variable/jetbrains-mono";
import "./model-services.css";
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
  const [advanced, setAdvanced] = useState(true);
  const [mapping, setMapping] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [rename, setRename] = useState("");
  const selected = providers.find((provider) => provider.id === draft?.id);
  const dirty = Boolean(
    draft &&
    (!selected ||
      key ||
      removeKey ||
      draft.name !== selected.name ||
      draft.api !== selected.api ||
      draft.baseUrl !== selected.baseUrl ||
      JSON.stringify(draft.models) !== JSON.stringify(selected.models)),
  );
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
    setMapping(
      JSON.stringify(
        index === undefined ? {} : (draft!.models[index]!.thinkingLevelMap ?? {}),
        null,
        2,
      ),
    );
    setAdvanced(true);
    setIntelligent(index === undefined);
    setDialog("model");
  };
  const applyTemplate = (id: string) => {
    const template = templates
      .filter((p) => p.api === draft?.api)
      .flatMap((p) => p.models)
      .find((m) => m.id === id);
    if (template) {
      setModel({ ...structuredClone(template), enabled: model.enabled });
      setMapping(JSON.stringify(template.thinkingLevelMap ?? {}, null, 2));
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
    let parsedMap: unknown;
    try {
      parsedMap = JSON.parse(mapping || "{}");
    } catch {
      setModelError(t("services.mappingInvalid"));
      return;
    }
    if (!Value.Check(ModelCompatSchemas[draft.api], model.compat ?? {})) {
      setModelError(t("services.apiIncompatible"));
      return;
    }
    if (
      !parsedMap ||
      typeof parsedMap !== "object" ||
      Array.isArray(parsedMap) ||
      Object.entries(parsedMap).some(
        ([level, value]) =>
          !THINKING_LEVELS.includes(level as (typeof THINKING_LEVELS)[number]) ||
          (value !== null && typeof value !== "string"),
      )
    ) {
      setModelError(t("services.mappingInvalid"));
      return;
    }
    const savedModel = {
      ...model,
      // The guard above validates every supported key and string/null value.
      thinkingLevelMap: parsedMap as ServiceModel["thinkingLevelMap"],
    };
    const models = [...draft.models];
    if (editing === undefined) models.push(savedModel);
    else models[editing] = savedModel;
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
  return (
    <section
      ref={surface}
      aria-label={t("services.title")}
      className="model-services fixed inset-x-0 bottom-0 top-11 z-30 flex min-h-0 text-foreground text-ui-base"
    >
      <p id="settings-unavailable" className="sr-only">
        {t("services.unavailable")}
      </p>
      <aside className="model-services-navigation" aria-label={t("services.navigation")}>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft className="size-4" />
          {t("services.back")}
        </Button>
        <Input
          disabled
          placeholder={t("services.search")}
          aria-label={t("services.search")}
          leftIcon={<Search className="size-4" />}
        />
        {(
          [
            [
              "personal",
              [
                ["appearance", Sun],
                ["general", Settings],
                ["usage", CircleUser],
                ["personalization", SlidersHorizontal],
                ["memory", Brain],
                ["shortcuts", Keyboard],
                ["voice", Mic],
                ["migration", Upload],
              ],
            ],
            [
              "environment",
              [
                ["computer", Hand],
                ["browser", Globe],
                ["runtime", Terminal],
                ["worktrees", GitBranch],
              ],
            ],
            [
              "extensions",
              [
                ["hooks", Anchor],
                ["plugins", Puzzle],
                ["skills", Box],
                ["mcp", Plug],
                ["agents", Bot],
                ["commands", Terminal],
              ],
            ],
          ] as const
        ).map(([group, items]) => (
          <div key={String(group)} className="model-services-nav-group">
            <p className="text-ui-sm text-muted-foreground">{t(`services.nav.${group}`)}</p>
            {items.map(([name, Icon]) => (
              <Button
                key={name}
                variant="ghost"
                size="sm"
                disabled
                title={t("services.unavailable")}
                aria-describedby="settings-unavailable"
              >
                <Icon className="size-4" />
                {t(`services.nav.${name}`)}
              </Button>
            ))}
          </div>
        ))}
        <div className="model-services-nav-group">
          <p className="text-ui-sm text-muted-foreground">{t("services.nav.models")}</p>
          <Button variant="secondary" size="sm" aria-current="page">
            <Server className="size-4" />
            {t("services.title")}
          </Button>
        </div>
      </aside>
      <div className="model-services-content">
        <div className="model-services-workspace">
          <header className="model-services-header">
            <h1 className="text-ui-xl font-medium">{t("services.title")}</h1>
            <p className="text-ui-base text-muted-foreground">{t("services.description")}</p>
            <div className="model-services-toolbar">
              <Button
                variant="secondary"
                size="icon"
                aria-label={t("services.refresh")}
                onClick={() => void load()}
              >
                <RefreshCw className="size-4" />
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setCatalog(true);
                  setError("");
                }}
              >
                <Plus className="size-4" />
                {t("services.addProvider")}
              </Button>
            </div>
          </header>
          <div className="model-services-panel">
            <aside aria-label={t("services.custom")} className="model-services-providers">
              <div className="model-services-builtins">
                <p className="text-ui-sm text-muted-foreground">{t("services.zhipu")}</p>
                <Button variant="ghost" size="sm" disabled title={t("services.unavailable")}>
                  <Sparkles className="size-4" />
                  BigModel
                  <Circle className="model-services-credential missing" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={
                    !templates.some(
                      (template) => template.id === "zai-coding-cn-openai-completions",
                    )
                  }
                  onClick={() =>
                    create(
                      templates.find(
                        (template) => template.id === "zai-coding-cn-openai-completions",
                      ),
                    )
                  }
                >
                  <Zap className="size-4" />
                  Z.ai Coding Plan
                  <Circle className="model-services-credential missing" />
                </Button>
              </div>
              <p className="text-ui-sm text-muted-foreground">{t("services.custom")}</p>
              {[
                ...providers,
                ...(draft && !selected ? [{ ...draft, hasCredential: false }] : []),
              ].map((provider) => (
                <Button
                  key={provider.id}
                  variant={!catalog && draft?.id === provider.id ? "secondary" : "ghost"}
                  size="sm"
                  className="justify-start truncate"
                  aria-label={provider.name}
                  aria-pressed={!catalog && draft?.id === provider.id}
                  disabled={pending}
                  onClick={() => choose(provider)}
                >
                  <Box className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{provider.name}</span>
                  <Circle
                    aria-label={t(
                      provider.hasCredential
                        ? "services.credentialReady"
                        : "services.credentialMissing",
                    )}
                    className={
                      provider.hasCredential
                        ? "model-services-credential ready"
                        : "model-services-credential missing"
                    }
                  />
                </Button>
              ))}
            </aside>
            <div className="model-services-details">
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
                <div className="model-services-catalog">
                  <div className="model-services-catalog-heading">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("services.returnDetail")}
                      onClick={() => setCatalog(false)}
                    >
                      <ArrowLeft className="size-4" />
                    </Button>
                    <h2 className="text-ui-lg">{t("services.addProvider")}</h2>
                  </div>
                  <p className="text-ui-sm text-muted-foreground">{t("services.catalog")}</p>
                  <Button
                    variant="secondary"
                    className="model-services-custom-tile"
                    onClick={() => create()}
                  >
                    <Plus className="size-6" />
                    {t("services.create")}
                    <ChevronRight className="ml-auto size-3.5" />
                  </Button>
                  {templates.map((template) => (
                    <Button
                      key={template.id}
                      variant="secondary"
                      className="model-services-template-tile"
                      aria-label={template.name}
                      onClick={() => create(template)}
                    >
                      <Box className="size-6" />
                      <span className="truncate">{template.name}</span>
                      <ChevronRight className="ml-auto size-3.5" />
                    </Button>
                  ))}
                </div>
              ) : draft ? (
                <div className="model-services-provider-form">
                  <div className="model-services-provider-heading flex items-center justify-between gap-2">
                    <h2 className="flex items-center gap-2 truncate text-ui-lg font-medium">
                      <Box className="size-5 text-muted-foreground" />
                      {draft.name}
                    </h2>
                    <div className="flex items-center gap-2">
                      <Switch
                        ariaLabel={t("services.providerEnabled")}
                        disabled={pending || !draft.models.length}
                        checked={draft.models.some((item) => item.enabled !== false)}
                        onCheckedChange={(enabled) =>
                          void persist({
                            ...draft,
                            models: draft.models.map((item) => ({ ...item, enabled })),
                          })
                        }
                      />
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
                        <Menu.DropdownMenuContent
                          align="end"
                          className="model-services-menu model-services-provider-menu"
                        >
                          <Menu.DropdownMenuItem
                            onSelect={() => {
                              setRename(draft.name);
                              setDialog("rename");
                            }}
                          >
                            <Pencil className="size-4" />
                            {t("services.rename")}
                          </Menu.DropdownMenuItem>
                          {selected?.hasCredential ? (
                            <Menu.DropdownMenuCheckboxItem
                              checked={removeKey}
                              onCheckedChange={setRemoveKey}
                            >
                              {t("services.keyDelete")}
                            </Menu.DropdownMenuCheckboxItem>
                          ) : null}
                          <Menu.DropdownMenuItem
                            aria-label={t("services.deleteProvider")}
                            className="text-danger"
                            onSelect={() => setDialog("delete")}
                          >
                            <Trash2 className="size-4" />
                            {t("services.delete")}
                          </Menu.DropdownMenuItem>
                        </Menu.DropdownMenuContent>
                      </Menu.DropdownMenu>
                    </div>
                  </div>
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
                      <SelectContent className="model-services-menu model-services-api-menu">
                        {Object.entries(protocols).map(([api, label]) => (
                          <SelectItem
                            key={api}
                            value={api}
                          >{`${label} (${routes[api as keyof typeof routes]})`}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="sr-only">
                    {t("services.route")}: {draft.baseUrl.replace(/\/$/, "")}
                    {routes[draft.api]}
                  </p>
                  <Input
                    disabled={pending}
                    label={t("services.key")}
                    type={showKey ? "text" : "password"}
                    autoComplete="off"
                    value={key}
                    placeholder={
                      selected?.hasCredential
                        ? "••••••••••••••••••••••••••••••••"
                        : t("services.keyPlaceholder")
                    }
                    rightIcon={
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("services.showKey")}
                        onClick={() => setShowKey(!showKey)}
                      >
                        {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </Button>
                    }
                    onChange={setKey}
                  />
                  {selected?.hasCredential ? (
                    <>
                      <p className="sr-only">{t("services.keyKeep")}</p>
                    </>
                  ) : null}
                  <div className="model-services-model-heading flex items-center justify-between gap-2">
                    <h3 className="font-medium">{t("services.models")}</h3>
                    <Button variant="secondary" size="sm" onClick={() => openModel()}>
                      <Plus className="size-4" />
                      {t("services.addModel")}
                    </Button>
                  </div>
                  {!draft.models.length ? (
                    <p className="model-services-empty text-ui-base text-muted-foreground">
                      <Info className="size-4 shrink-0" />
                      {t("services.empty")}
                    </p>
                  ) : (
                    draft.models.map((item, index) => (
                      <div key={item.id} className="model-services-model-row">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono">{item.id}</p>
                          <p className="model-services-model-metadata text-ui-xs text-muted-foreground">
                            <span>
                              {new Intl.NumberFormat("en", {
                                notation: "compact",
                                maximumFractionDigits: 1,
                              }).format(item.contextWindow ?? 128000)}
                            </span>
                            {item.input?.includes("image") ? (
                              <span>{t("services.vision")}</span>
                            ) : null}
                            {item.reasoning ? ` · ${t("services.reasoning")}` : ""}
                          </p>
                        </div>
                        <Switch
                          ariaLabel={t("services.enabled")}
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
                          size="icon"
                          aria-label={t("services.test")}
                          variant="ghost"
                          disabled={!services.test || pending}
                          onClick={() => void testConnection(item.id)}
                        >
                          <Unplug className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={t("services.edit")}
                          onClick={() => openModel(index)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          aria-label={t("services.deleteModel")}
                          variant="ghost"
                          disabled={pending}
                          onClick={() =>
                            void persist({
                              ...draft,
                              models: draft.models.filter((_, i) => i !== index),
                            })
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))
                  )}
                  {dirty ? (
                    <div className="model-services-save flex gap-2">
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
                  ) : null}
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setCatalog(true)}>
                  {t("services.addProvider")}
                </Button>
              )}
            </div>
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
        className={
          dialog === "model"
            ? "model-services-modal model-services-model-modal"
            : "model-services-modal model-services-confirm-modal"
        }
      >
        {dialog === "model" ? (
          <form
            className="model-services-model-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveModel();
            }}
          >
            <h2 className="shrink-0 text-ui-lg font-medium">
              {t(editing === undefined ? "services.addModel" : "services.editModel")}
            </h2>
            <Button
              className="model-services-close"
              variant="ghost"
              size="icon"
              aria-label={t("services.close")}
              onClick={() => setDialog(null)}
            >
              <X className="size-4" />
            </Button>
            <div className="model-services-model-fields">
              <div className="model-services-intelligent">
                <span>{t("services.intelligent")}</span>
                <Info
                  className="size-3.5 text-muted-foreground"
                  aria-label={t("services.templateNote")}
                />
                <Switch
                  checked={intelligent}
                  ariaLabel={t("services.intelligent")}
                  onCheckedChange={(value) => {
                    setIntelligent(value);
                    if (value) applyTemplate(model.id);
                  }}
                />
              </div>
              {modelNotice ? (
                <p className="text-ui-xs text-muted-foreground">{modelNotice}</p>
              ) : null}
              <Input
                label={t("services.id")}
                placeholder={t("services.id")}
                autoFocus
                value={model.id}
                onChange={(id) => (intelligent ? applyTemplate(id) : setModel({ ...model, id }))}
              />
              <div className="model-services-token-fields">
                <div className="model-services-help-field">
                  <Input
                    label={t("services.context")}
                    type="number"
                    min={1}
                    value={String(model.contextWindow ?? "")}
                    onChange={(value) => setModel({ ...model, contextWindow: Number(value) })}
                  />
                  <Info
                    className="model-services-field-help context-help"
                    aria-label={t("services.context")}
                  />
                </div>
                <div className="model-services-help-field">
                  <Input
                    label={t("services.tokens")}
                    type="number"
                    min={1}
                    value={String(model.maxTokens ?? "")}
                    onChange={(value) => setModel({ ...model, maxTokens: Number(value) })}
                  />
                  <Info
                    className="model-services-field-help tokens-help"
                    aria-label={t("services.tokens")}
                  />
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={advanced}
                onClick={() => setAdvanced(!advanced)}
              >
                <ChevronDown className="size-4" />
                {t("services.advanced")}
              </Button>
              <div className="model-services-advanced" hidden={!advanced}>
                <p className="model-services-help-label">
                  {t("services.inputs")}
                  <Tooltip content={t("services.unsupported")}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="model-services-capability-help"
                      aria-label={t("services.inputsInfo")}
                      aria-describedby="model-services-unsupported"
                    >
                      <Info aria-hidden="true" />
                    </Button>
                  </Tooltip>
                </p>
                <div className="model-services-chips">
                  <Checkbox
                    checked
                    disabled
                    label={t("services.text")}
                    onCheckedChange={() => {}}
                  />
                  <LockKeyhole className="model-services-text-lock" aria-hidden="true" />
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
                    aria-describedby="model-services-unsupported"
                    onCheckedChange={() => {}}
                  />
                  <Checkbox
                    checked={false}
                    disabled
                    label={t("services.pdf")}
                    aria-describedby="model-services-unsupported"
                    onCheckedChange={() => {}}
                  />
                </div>
                <p className="model-services-help-label">
                  {t("services.capabilities")}
                  <Tooltip content={t("services.unsupported")}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="model-services-capability-help"
                      aria-label={t("services.capabilitiesInfo")}
                      aria-describedby="model-services-unsupported"
                    >
                      <Info aria-hidden="true" />
                    </Button>
                  </Tooltip>
                </p>
                <div className="model-services-chips">
                  <Checkbox
                    checked={false}
                    disabled
                    label={t("services.structured")}
                    aria-describedby="model-services-unsupported"
                    onCheckedChange={() => {}}
                  />
                  <Checkbox
                    checked={false}
                    disabled
                    label={t("services.web")}
                    aria-describedby="model-services-unsupported"
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
                <p className="sr-only" id="model-services-unsupported">
                  {t("services.unsupported")}
                </p>
                <div className="model-services-levels">
                  <p className="model-services-help-label">
                    {t("services.levels")}
                    <Info aria-hidden="true" />
                  </p>
                  <div className="model-services-chips">
                    {model.reasoning
                      ? THINKING_LEVELS.filter(
                          (level) =>
                            model.thinkingLevelMap?.[level] !== null &&
                            model.thinkingLevelMap?.[level] !== undefined,
                        ).map((level) => (
                          <span key={level} className="model-services-level-chip">
                            {t(`services.${level}`)}
                          </span>
                        ))
                      : null}
                    <Menu.DropdownMenu>
                      <Menu.DropdownMenuTrigger asChild>
                        <Button variant="secondary" size="icon" aria-label={t("services.levels")}>
                          <Plus className="size-4" />
                        </Button>
                      </Menu.DropdownMenuTrigger>
                      <Menu.DropdownMenuContent className="model-services-menu">
                        <Menu.DropdownMenuCheckboxItem
                          checked={model.reasoning ?? false}
                          onCheckedChange={(reasoning) => setModel({ ...model, reasoning })}
                        >
                          {t("services.reasoning")}
                        </Menu.DropdownMenuCheckboxItem>
                        {THINKING_LEVELS.map((level) => (
                          <Menu.DropdownMenuCheckboxItem
                            key={level}
                            checked={
                              model.reasoning === true &&
                              model.thinkingLevelMap?.[level] !== undefined &&
                              model.thinkingLevelMap?.[level] !== null
                            }
                            onCheckedChange={(enabled) => {
                              const map = {
                                ...model.thinkingLevelMap,
                                [level]: enabled ? level : null,
                              };
                              setModel({ ...model, reasoning: true, thinkingLevelMap: map });
                              setMapping(JSON.stringify(map, null, 2));
                            }}
                          >
                            {t(`services.${level}`)}
                          </Menu.DropdownMenuCheckboxItem>
                        ))}
                      </Menu.DropdownMenuContent>
                    </Menu.DropdownMenu>
                  </div>
                </div>
                <label className="model-services-mapping">
                  <span className="model-services-help-label">
                    {t("services.mapping")}
                    <Info aria-hidden="true" />
                  </span>
                  <Textarea
                    aria-label={t("services.mapping")}
                    value={mapping}
                    onChange={(event) => setMapping(event.target.value)}
                  />
                </label>
              </div>
              {modelError || error ? (
                <p role="alert" className="text-ui-sm text-danger">
                  {modelError || error}
                </p>
              ) : null}
            </div>
            <div className="model-services-modal-footer">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setModel(structuredClone(defaultModel));
                  setModelError("");
                  setModelNotice("");
                  setIntelligent(false);
                  setMapping("{}");
                }}
              >
                {t("services.reset")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDialog(null)} disabled={pending}>
                {t("services.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={pending}
                aria-label={t("services.saveModel")}
              >
                {t("services.save")}
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
          <div className="model-services-delete flex flex-col gap-3">
            <h2 className="font-medium">
              {t("services.deleteTitle", { name: draft?.name ?? "" })}
            </h2>
            <p className="text-ui-sm text-muted-foreground">{t("services.deleteNote")}</p>
            <div className="model-services-delete-footer flex justify-end gap-2">
              <Button
                variant="secondary"
                aria-label={t("services.cancel")}
                onClick={() => setDialog(null)}
                disabled={pending}
              >
                {t("services.cancel")}
                <kbd aria-hidden="true">esc</kbd>
              </Button>
              <Button
                aria-label={t("services.confirm")}
                data-confirm-delete
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
                <CornerDownLeft aria-hidden="true" className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </MorphingModal>
    </section>
  );
}
