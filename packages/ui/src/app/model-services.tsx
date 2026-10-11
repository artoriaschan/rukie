import { Value } from "typebox/value";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CornerDownLeft,
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
  Bot,
  Box,
  Circle,
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
import { ScrollArea } from "../components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "../components/motion/radio";
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
  const [advanced, setAdvanced] = useState(false);
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
  const create = () => {
    choose({
      id: `provider-${crypto.randomUUID()}`,
      name: t("services.new"),
      api: "anthropic-messages",
      baseUrl: "",
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
    setAdvanced(false);
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
      <ScrollArea
        className="model-services-navigation-scroll"
        viewportClassName="model-services-navigation"
        aria-label={t("services.navigation")}
      >
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
      </ScrollArea>
      <ScrollArea
        className="model-services-content-scroll"
        viewportClassName="model-services-content"
        viewportLabel={t("services.title")}
      >
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
            <ScrollArea
              viewportLabel={t("services.custom")}
              className="model-services-providers-scroll"
              viewportClassName="model-services-providers"
            >
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
            </ScrollArea>
            <ScrollArea
              className="model-services-details-scroll"
              viewportClassName="model-services-details"
              viewportLabel={t("services.providerDetails")}
            >
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
            </ScrollArea>
          </div>
        </div>
      </ScrollArea>
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
            <header className="model-services-model-header">
              <h2 className="text-ui-xl font-medium">
                {t(editing === undefined ? "services.addModel" : "services.editModel")}
              </h2>
              <p className="text-ui-sm text-muted-foreground">{t("services.modelDescription")}</p>
              <Button
                className="model-services-close"
                variant="ghost"
                size="icon"
                aria-label={t("services.close")}
                onClick={() => setDialog(null)}
              >
                <X className="size-4" />
              </Button>
            </header>
            <ScrollArea
              className="model-services-fields-scroll"
              viewportClassName="model-services-model-fields"
              viewportLabel={t("services.modelConfiguration")}
            >
              <section className="model-services-basic">
                <h3 className="text-ui-base">{t("services.basic")}</h3>
                <Input
                  label={t("services.id")}
                  placeholder={t("services.id")}
                  autoFocus
                  value={model.id}
                  onChange={(id) => (intelligent ? applyTemplate(id) : setModel({ ...model, id }))}
                />
                <div className="model-services-basic-columns">
                  <Input
                    label={t("services.displayName")}
                    value={model.id}
                    disabled
                    title={t("services.unsupportedFields")}
                    aria-describedby="model-services-unavailable-fields"
                  />
                  <Input
                    label={t("services.context")}
                    type="number"
                    min={1}
                    value={String(model.contextWindow ?? "")}
                    onChange={(value) => setModel({ ...model, contextWindow: Number(value) })}
                  />
                </div>
                <p className="sr-only" id="model-services-unavailable-fields">
                  {t("services.unsupportedFields")}
                </p>
              </section>
              <section className="model-services-reasoning">
                <h3 className="text-ui-base">{t("services.reasoningCapabilities")}</h3>
                <RadioGroup
                  orientation="horizontal"
                  value={model.reasoning ? "reasoning" : "off"}
                  onValueChange={(value) =>
                    setModel({ ...model, reasoning: value === "reasoning" })
                  }
                >
                  <RadioGroupItem value="off" label={t("services.noReasoning")} />
                  <RadioGroupItem value="locked" label={t("services.fixedReasoning")} disabled />
                  <RadioGroupItem value="reasoning" label={t("services.variableReasoning")} />
                </RadioGroup>
                <div className="model-services-reasoning-columns">
                  <div>
                    <p className="text-ui-sm text-muted-foreground">{t("services.levels")}</p>
                    <div className="model-services-chips">
                      {THINKING_LEVELS.map((level) => (
                        <Checkbox
                          key={level}
                          label={t(`services.${level}`)}
                          checked={
                            model.reasoning === true &&
                            model.thinkingLevelMap?.[level] !== undefined &&
                            model.thinkingLevelMap?.[level] !== null
                          }
                          disabled={!model.reasoning}
                          onCheckedChange={(enabled) => {
                            const map = {
                              ...model.thinkingLevelMap,
                              [level]: enabled ? level : null,
                            };
                            setModel({ ...model, thinkingLevelMap: map });
                            setMapping(JSON.stringify(map, null, 2));
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <Input
                    label={t("services.defaultReasoning")}
                    value=""
                    disabled
                    title={t("services.unsupportedFields")}
                    aria-describedby="model-services-unavailable-fields"
                  />
                </div>
              </section>
              <section className="model-services-multimodal">
                <h3 className="text-ui-base">{t("services.multimodal")}</h3>
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
              </section>
              <div className="model-services-advanced-shell">
                <Button
                  variant="ghost"
                  size="sm"
                  className="model-services-advanced-toggle"
                  aria-expanded={advanced}
                  onClick={() => setAdvanced(!advanced)}
                >
                  <span>
                    <span>{t("services.advanced")}</span>
                    <span className="text-ui-sm text-muted-foreground">
                      {t("services.advancedDescription")}
                    </span>
                  </span>
                  <ChevronDown className="ml-auto size-4" />
                </Button>
                <div className="model-services-advanced" hidden={!advanced}>
                  <div className="model-services-intelligent">
                    <span>{t("services.intelligent")}</span>
                    <Tooltip content={t("services.templateNote")}>
                      <Info className="size-3.5 text-muted-foreground" />
                    </Tooltip>
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
                    <p className="text-ui-sm text-muted-foreground">{modelNotice}</p>
                  ) : null}
                  <p
                    className="text-ui-sm text-muted-foreground"
                    id="model-services-advanced-unavailable"
                  >
                    {t("services.advancedUnavailable")}
                  </p>
                  <div className="model-services-advanced-columns">
                    <section className="model-services-option-card">
                      <h3>{t("services.compression")}</h3>
                      <Input
                        label={t("services.compressionThreshold")}
                        value=""
                        disabled
                        aria-describedby="model-services-advanced-unavailable"
                      />
                    </section>
                    <section className="model-services-option-card">
                      <h3>{t("services.runtime")}</h3>
                      <div className="model-services-basic-columns">
                        <Input
                          label="Temperature"
                          value=""
                          disabled
                          aria-describedby="model-services-advanced-unavailable"
                        />
                        <Input
                          label={t("services.tokens")}
                          type="number"
                          min={1}
                          value={String(model.maxTokens ?? "")}
                          onChange={(value) => setModel({ ...model, maxTokens: Number(value) })}
                        />
                      </div>
                      <Input
                        label={t("services.toolIterations")}
                        value=""
                        disabled
                        aria-describedby="model-services-advanced-unavailable"
                      />
                    </section>
                  </div>
                  <section className="model-services-option-card">
                    <h3>{t("services.price")}</h3>
                    <div className="model-services-price-columns">
                      {(
                        ["inputPrice", "outputPrice", "cacheReadPrice", "cacheWritePrice"] as const
                      ).map((field) => (
                        <Input
                          key={field}
                          label={t(`services.${field}`)}
                          value=""
                          disabled
                          aria-describedby="model-services-advanced-unavailable"
                        />
                      ))}
                    </div>
                    <Input
                      label={t("services.priceSource")}
                      value=""
                      disabled
                      aria-describedby="model-services-advanced-unavailable"
                    />
                  </section>
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
                  <label className="model-services-mapping">
                    <span className="model-services-help-label">
                      {t("services.mapping")}
                      <Info aria-hidden="true" />
                    </span>
                    <ScrollArea
                      className="model-services-mapping-scroll"
                      viewportLabel={t("services.mapping")}
                    >
                      <Textarea
                        ref={(field) => {
                          if (field) {
                            field.style.height = "0px";
                            field.style.height = `${Math.max(64, field.scrollHeight)}px`;
                          }
                        }}
                        aria-label={t("services.mapping")}
                        value={mapping}
                        onChange={(event) => setMapping(event.target.value)}
                      />
                    </ScrollArea>
                  </label>
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
                </div>
              </div>
              {modelError || error ? (
                <p role="alert" className="text-ui-sm text-danger">
                  {modelError || error}
                </p>
              ) : null}
            </ScrollArea>
            <div className="model-services-modal-footer">
              <Button
                className="model-services-model-cancel"
                variant="ghost"
                size="sm"
                onClick={() => setDialog(null)}
                disabled={pending}
              >
                {t("services.cancel")}
              </Button>
              <Button
                className="model-services-model-save"
                type="submit"
                size="sm"
                disabled={pending}
                aria-label={t("services.saveModel")}
              >
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
