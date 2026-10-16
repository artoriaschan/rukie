import { AppearanceSettings } from "./appearance-settings";
import { createAppearance, type Appearance } from "../lib/appearance";
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
  MODEL_SERVICE_THINKING_LEVELS,
  modelServiceThinkingLevels,
  type ModelService,
  type ModelServiceSummary,
  type ModelServiceSave,
} from "@rukie/shared";
import { WorktreeSettings } from "./worktree-settings";
import type { ClientCommand } from "../client";
import type { DesktopHost } from "../host";
import { ProviderIcon } from "../components/provider-icon";
import { Button } from "../components/motion/button/base";
import { Input } from "../components/motion/input";
import { Checkbox } from "../components/motion/checkbox";
import { Select, SelectTrigger, SelectContent, SelectItem } from "../components/motion/select";
import { MorphingModal } from "../components/motion/morphing-modal";
import { Tooltip } from "../components/motion/tooltip";
import { Switch } from "../components/motion/switch";
import { ScrollArea } from "../components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "../components/motion/radio";
import "./model-services.css";
import * as Menu from "../components/ui/dropdown-menu";
import { useAppText } from "../lib/i18n";
import { PROVIDER_PRESETS, type ProviderPreset } from "../lib/provider-presets";
import { reasoningLabels } from "../lib/reasoning-labels";

type Services = DesktopHost["modelServices"];
type ServiceModel = ModelService["models"][number];
const advancedNumericFields = [
  "compressionThreshold",
  "temperature",
  "maxToolIterations",
  "inputPrice",
  "outputPrice",
  "cacheReadPrice",
  "cacheWritePrice",
] as const;
const priceFields = ["inputPrice", "outputPrice", "cacheReadPrice", "cacheWritePrice"] as const;
type AdvancedNumericField = (typeof advancedNumericFields)[number];
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
  getAppearance,
  onChanged,
  request,
}: {
  services: Services;
  getAppearance?: () => Appearance;
  request?: (command: ClientCommand) => Promise<unknown>;
  onChanged: () => Promise<void>;
}) {
  const t = useAppText();
  const localAppearance = useRef<Appearance | undefined>(undefined);
  const resolveAppearance = () =>
    getAppearance?.() ?? (localAppearance.current ??= createAppearance());
  useEffect(() => () => localAppearance.current?.dispose(), []);
  const [page, setPage] = useState<"models" | "worktrees" | "appearance">("models");
  const surface = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const current = surface.current?.querySelector<HTMLButtonElement>(
      'button[aria-current="page"]',
    );
    const target = current?.getClientRects().length ? current : surface.current;
    target?.focus({ preventScroll: true });
    return () => previous?.focus();
  }, []);
  const [providers, setProviders] = useState<ModelServiceSummary[]>([]);
  const [draft, setDraft] = useState<ModelService>();
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [catalog, setCatalog] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [dialog, setDialog] = useState<"model" | "rename" | "delete" | null>(null);
  const dialogIdentity = useRef(0);
  const dialogSubmission = useRef<number | undefined>(undefined);
  const [dialogPending, setDialogPending] = useState(false);
  const changeDialog = (next: "model" | "rename" | "delete" | null) => {
    dialogIdentity.current++;
    dialogSubmission.current = undefined;
    setDialogPending(false);
    setError("");
    setDialog(next);
  };
  const [editing, setEditing] = useState<number>();
  const newModelIndex = useRef<number | undefined>(undefined);
  const [model, setModel] = useState<ServiceModel>(defaultModel);
  const [modelError, setModelError] = useState("");
  const [advancedDraft, setAdvancedDraft] = useState<Partial<Record<AdvancedNumericField, string>>>(
    {},
  );
  const editAdvanced = (field: AdvancedNumericField, value: string) => {
    priceTouched.current.add(field);
    setAdvancedDraft((previous) => ({ ...previous, [field]: value }));
  };
  const [priceLoading, setPriceLoading] = useState(false);
  const [priceStatus, setPriceStatus] = useState("");
  const attemptedPriceIdentity = useRef("");
  const activePriceIdentity = useRef("");
  const priceRequest = useRef(0);
  const autoPrices = useRef(new Set<string>());
  const priceTouched = useRef(new Set<string>());
  const currentPriceIdentity = useRef("");
  currentPriceIdentity.current =
    dialog === "model" && draft ? `${draft.id}|${draft.baseUrl}|${model.id}` : "";
  useEffect(
    () => () => {
      priceRequest.current++;
    },
    [],
  );
  const fillPrices = async (candidate: ServiceModel) => {
    if (!draft || !candidate.id.trim()) return;
    const identity = `${draft.id}|${draft.baseUrl}|${candidate.id}`;
    if (activePriceIdentity.current === identity) return;
    activePriceIdentity.current = identity;
    attemptedPriceIdentity.current = identity;
    setPriceLoading(true);
    const request = ++priceRequest.current;
    setPriceStatus(t("services.priceLoading"));
    try {
      const result = await services.prices({ baseUrl: draft.baseUrl, modelId: candidate.id });
      if (request !== priceRequest.current || currentPriceIdentity.current !== identity) return;
      if (result.status !== "found") {
        setPriceStatus(t(`services.price${result.status}`));
        return;
      }
      setModel((previous) => {
        const next = { ...previous };
        for (const field of priceFields) {
          if (
            next[field] === undefined &&
            !priceTouched.current.has(field) &&
            result.prices[field] !== undefined
          ) {
            next[field] = result.prices[field];
            autoPrices.current.add(field);
          }
        }
        if (!next.priceSource && !priceTouched.current.has("priceSource")) {
          next.priceSource = result.priceSource;
          autoPrices.current.add("priceSource");
        }
        return next;
      });
      setPriceStatus(t("services.priceFound"));
    } catch {
      if (request === priceRequest.current && currentPriceIdentity.current === identity)
        setPriceStatus(t("services.priceunavailable"));
    } finally {
      if (request === priceRequest.current) {
        activePriceIdentity.current = "";
        setPriceLoading(false);
      }
    }
  };
  const [advanced, setAdvanced] = useState(false);
  const [defaultReasoningOpen, setDefaultReasoningOpen] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [revealedKey, setRevealedKey] = useState("");
  const [revealing, setRevealing] = useState(false);
  const revealRequest = useRef(0);
  const clearRevealedKey = () => {
    revealRequest.current++;
    setRevealedKey("");
    setShowKey(false);
    setRevealing(false);
  };
  useEffect(
    () => () => {
      revealRequest.current++;
    },
    [],
  );
  const [rename, setRename] = useState("");
  const supportedLevels = modelServiceThinkingLevels(model);
  const selected = providers.find((provider) => provider.id === draft?.id);
  const empty = providers.length === 0 && !draft && !catalog;
  const createdPreset = useRef<ProviderPreset | undefined>(undefined);
  const draftRef = useRef<ModelService | undefined>(undefined);
  const keyRef = useRef("");
  const removeKeyRef = useRef(false);
  const revision = useRef(0);
  const queued = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const generation = useRef(0);
  const flush = () => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
    if (!queued.current || !draftRef.current) return writes.current;
    queued.current = false;
    return persist(draftRef.current);
  };
  const updateDraft = (provider: ModelService, debounce = false) => {
    draftRef.current = provider;
    setDraft(provider);
    revision.current++;
    queued.current = true;
    if (timer.current !== undefined) clearTimeout(timer.current);
    if (debounce) timer.current = setTimeout(() => void flush(), 500);
    else void flush();
  };
  const choose = (provider: ModelService) => {
    void flush();
    if (draftRef.current?.id === provider.id) {
      setCatalog(false);
      return;
    }
    createdPreset.current = undefined;
    clearRevealedKey();
    const next = structuredClone({
      id: provider.id,
      name: provider.name,
      icon: provider.icon,
      enabled: provider.enabled,
      api: provider.api,
      baseUrl: provider.baseUrl,
      models: provider.models,
    });
    draftRef.current = next;
    setDraft(next);
    revision.current++;
    keyRef.current = "";
    removeKeyRef.current = false;
    setKey("");
    setRemoveKey(false);
    setError("");
    setStatus("");
    setCatalog(false);
  };
  const toggleKey = async () => {
    if (showKey || revealing) {
      clearRevealedKey();
      return;
    }
    if (key || removeKey || !selected?.hasCredential) {
      setShowKey(true);
      return;
    }
    const request = ++revealRequest.current;
    setRevealing(true);
    setError("");
    try {
      const value = await services.revealKey(selected.id);
      if (request !== revealRequest.current) return;
      if (!value) throw new Error("Credential unavailable");
      setRevealedKey(value);
      setShowKey(true);
    } catch {
      if (request === revealRequest.current) {
        setRevealedKey("");
        setShowKey(false);
        setError(t("services.keyRevealFailure"));
      }
    } finally {
      if (request === revealRequest.current) setRevealing(false);
    }
  };
  const load = async () => {
    try {
      const currentGeneration = generation.current;
      await flush();
      const result = await services.list();
      if (!mounted.current || currentGeneration !== generation.current) return;
      setProviders(result);
      if (!draftRef.current && result[0]) choose(result[0]);
      setError("");
    } catch {
      setError(t("services.loadFailure"));
    }
  };
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      void flush();
      mounted.current = false;
      generation.current++;
      dialogIdentity.current++;
      createdPreset.current = undefined;
    };
  }, [services]);
  const persist = (
    provider: ModelService,
    creationCredential?: ModelServiceSave["credential"],
    submittedDialog?: number,
  ): Promise<boolean> => {
    const currentDialog = () =>
      submittedDialog === undefined || submittedDialog === dialogIdentity.current;
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
    queued.current = false;
    clearRevealedKey();
    const current = structuredClone(provider);
    const savedRevision = revision.current;
    const currentGeneration = generation.current;
    const credential =
      creationCredential ??
      (removeKeyRef.current
        ? { type: "delete" as const }
        : keyRef.current.trim()
          ? { type: "replace" as const, value: keyRef.current }
          : { type: "keep" as const });
    if (!creationCredential)
      setProviders((previous) => {
        const existing = previous.find((p) => p.id === current.id);
        return [
          ...previous.filter((p) => p.id !== current.id),
          { ...current, hasCredential: Boolean(existing?.hasCredential) },
        ];
      });
    // Queue immutable snapshots at the host boundary; responses never replace a newer draft.
    const operation = writes.current.then(async () => {
      try {
        await services.save({ provider: current, credential });
        if (mounted.current && generation.current === currentGeneration) {
          setProviders((previous) => {
            const existing = previous.find((p) => p.id === current.id);
            const hasCredential =
              credential.type === "replace" ||
              (credential.type === "keep" && Boolean(existing?.hasCredential));
            const latest = existing ?? current;
            return [...previous.filter((p) => p.id !== current.id), { ...latest, hasCredential }];
          });
          if (draftRef.current?.id === current.id && savedRevision === revision.current) {
            keyRef.current = "";
            removeKeyRef.current = false;
            setKey("");
            setRemoveKey(false);
            if (currentDialog()) setError("");
          }
        }
        try {
          await onChanged();
        } catch {
          if (mounted.current && generation.current === currentGeneration && currentDialog())
            setError(t("services.refreshFailure"));
        }
        return true;
      } catch {
        if (mounted.current && generation.current === currentGeneration && currentDialog())
          setError(t("services.saveFailure"));
        return false;
      }
    });
    writes.current = operation;
    return operation;
  };
  const create = async (preset?: ProviderPreset) => {
    let number = 1;
    while (
      preset &&
      providers.some((p) => p.id === (number === 1 ? preset.id : `${preset.id}-${number}`))
    )
      number++;
    const provider: ModelService = preset
      ? {
          id: number === 1 ? preset.id : `${preset.id}-${number}`,
          name: number === 1 ? preset.name : `${preset.name} ${number}`,
          api: preset.defaultApi,
          ...structuredClone(preset.variants[preset.defaultApi]!),
          icon: preset.icon,
          enabled: true,
        }
      : {
          id: `provider-${crypto.randomUUID()}`,
          name: t("services.new"),
          api: "anthropic-messages",
          baseUrl: "",
          models: [],
          enabled: true,
        };
    void flush();
    setPending(true);
    try {
      if (await persist(provider, { type: "keep" })) {
        choose(provider);
        createdPreset.current = preset;
      }
    } finally {
      setPending(false);
    }
  };
  const openModel = (index?: number) => {
    priceRequest.current++;
    activePriceIdentity.current = "";
    attemptedPriceIdentity.current = "";
    setPriceLoading(false);
    priceTouched.current.clear();
    autoPrices.current.clear();
    setPriceStatus("");
    setEditing(index);
    newModelIndex.current = undefined;
    setModel(structuredClone(index === undefined ? defaultModel : draft!.models[index]!));
    setModelError("");
    setAdvancedDraft({});
    setAdvanced(false);
    changeDialog("model");
    if (
      index !== undefined &&
      priceFields.some((field) => draft!.models[index]![field] === undefined)
    )
      void fillPrices(draft!.models[index]!);
  };
  const saveModel = async () => {
    if (activePriceIdentity.current || dialogSubmission.current === dialogIdentity.current) return;
    if (
      draft &&
      model.id.trim() &&
      priceFields.some((field) => model[field] === undefined) &&
      attemptedPriceIdentity.current !== `${draft.id}|${draft.baseUrl}|${model.id}`
    ) {
      void fillPrices(model);
      return;
    }
    if (!draft) return;
    const identity = dialogIdentity.current;
    dialogSubmission.current = identity;
    setDialogPending(true);
    const savedModel = { ...model };
    for (const field of advancedNumericFields) {
      const value = advancedDraft[field];
      if (value !== undefined) savedModel[field] = value === "" ? undefined : Number(value);
    }
    const models = [...draft.models];
    const index = editing ?? newModelIndex.current ?? models.length;
    models[index] = savedModel;
    // A failed creation remains the same draft slot when this dialog retries.
    if (editing === undefined) newModelIndex.current = index;
    const next = { ...draft, models };
    draftRef.current = next;
    setDraft(next);
    revision.current++;
    const saved = await persist(next, undefined, identity);
    if (dialogIdentity.current !== identity) return;
    dialogSubmission.current = undefined;
    setDialogPending(false);
    if (saved) changeDialog(null);
    else setModelError(t("services.saveFailure"));
  };
  const testConnection = async (modelId: string) => {
    if (!draft || pending) return;
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
      tabIndex={-1}
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
        <Input
          size="scoped"
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
          <div
            key={String(group)}
            className={`model-services-nav-group ${group === "environment" || group === "personal" ? "worktree-settings-navigation" : ""}`}
          >
            <p className="text-ui-sm text-muted-foreground">{t(`services.nav.${group}`)}</p>
            {items.map(([name, Icon]) => (
              <Button
                key={name}
                aria-label={t(`services.nav.${name}`)}
                data-settings-page={name}
                variant={name === page ? "secondary" : "ghost"}
                size="contextual"
                disabled={name !== "appearance" && (name !== "worktrees" || !request)}
                aria-current={name === page ? "page" : undefined}
                onClick={() => {
                  if (name === "appearance") resolveAppearance();
                  if (name === "appearance" || name === "worktrees") setPage(name);
                }}
                title={
                  name === "appearance" || (name === "worktrees" && request)
                    ? t(`services.nav.${name}`)
                    : t("services.unavailable")
                }
                aria-describedby={
                  name === "appearance" || (name === "worktrees" && request)
                    ? undefined
                    : "settings-unavailable"
                }
              >
                <Icon className="size-3" />
                <span>{t(`services.nav.${name}`)}</span>
              </Button>
            ))}
          </div>
        ))}
        <div className="model-services-nav-group worktree-settings-navigation">
          <p className="text-ui-sm text-muted-foreground">{t("services.nav.models")}</p>
          <Button
            aria-label={t("services.title")}
            data-settings-page="models"
            variant={page === "models" ? "secondary" : "ghost"}
            size="contextual"
            aria-current={page === "models" ? "page" : undefined}
            onClick={() => setPage("models")}
          >
            <Server className="size-3" />
            <span>{t("services.title")}</span>
          </Button>
        </div>
      </ScrollArea>
      <ScrollArea
        className="model-services-content-scroll"
        viewportClassName="model-services-content"
        viewportLabel={page === "models" ? t("services.title") : t(`services.nav.${page}`)}
      >
        {page === "appearance" ? (
          <AppearanceSettings appearance={resolveAppearance()} />
        ) : page === "worktrees" && request ? (
          <WorktreeSettings request={request} />
        ) : (
          <div className="model-services-workspace">
            <header className="model-services-header">
              <h1 className="text-ui-xl font-medium">{t("services.title")}</h1>
              <p className="text-ui-base text-muted-foreground">{t("services.description")}</p>
              {!empty ? (
                <div className="model-services-toolbar">
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label={t("services.refresh")}
                    onClick={() => void load()}
                  >
                    <RefreshCw />
                  </Button>
                  <Button
                    size="contextual"
                    onClick={() => {
                      setCatalog(true);
                      setError("");
                    }}
                  >
                    <Plus className="size-3" />
                    {t("services.addProvider")}
                  </Button>
                </div>
              ) : null}
            </header>
            <div className="model-services-panel">
              {empty ? (
                <section
                  className="model-services-provider-empty"
                  aria-labelledby="provider-empty-title"
                >
                  <Box aria-hidden="true" className="model-services-provider-empty-icon" />
                  <h2 id="provider-empty-title">{t("services.providerEmptyTitle")}</h2>
                  <p>{t("services.providerEmptyDescription")}</p>
                  <Button
                    size="contextual"
                    onClick={() => {
                      setCatalog(true);
                      setError("");
                    }}
                  >
                    <Plus className="size-3" />
                    {t("services.addProvider")}
                  </Button>
                  {error ? (
                    <div className="model-services-provider-empty-error text-ui-sm text-danger">
                      <p role="alert">{error}</p>
                      {error === t("services.loadFailure") ? (
                        <Button variant="ghost" size="contextual" onClick={() => void load()}>
                          {t("services.retry")}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              ) : (
                <>
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
                        size="contextual"
                        className="justify-start truncate"
                        aria-label={provider.name}
                        aria-pressed={!catalog && draft?.id === provider.id}
                        disabled={pending}
                        onClick={() => choose(provider)}
                      >
                        <ProviderIcon
                          icon={provider.icon}
                          variant="color"
                          className="text-muted-foreground"
                        />
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
                          <Button variant="ghost" size="contextual" onClick={() => void load()}>
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
                            <ArrowLeft />
                          </Button>
                          <h2 className="text-ui-lg">{t("services.addProvider")}</h2>
                        </div>
                        <div className="model-services-catalog-cards">
                          <Button
                            size="compact"
                            variant="secondary"
                            className="model-services-catalog-tile"
                            onClick={() => void create()}
                            disabled={pending}
                          >
                            <span className="model-services-custom-icon">
                              <Plus className="size-3" />
                            </span>
                            <span className="model-services-catalog-label">
                              {t("services.create")}
                            </span>
                            <ChevronRight className="ml-auto size-3" />
                          </Button>
                          {PROVIDER_PRESETS.map((preset) => (
                            <Button
                              size="compact"
                              key={preset.id}
                              variant="secondary"
                              className="model-services-catalog-tile"
                              onClick={() => void create(preset)}
                              disabled={pending}
                            >
                              <span className="model-services-preset-icon">
                                <ProviderIcon
                                  icon={preset.icon}
                                  variant="color"
                                  className="size-3"
                                />
                              </span>
                              <span className="model-services-catalog-label">
                                {t(`services.presets.${preset.id}`)}
                              </span>
                              <ChevronRight className="ml-auto size-3" />
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : draft ? (
                      <div className="model-services-provider-form">
                        <div className="model-services-provider-heading flex items-center justify-between gap-2">
                          <h2 className="flex items-center gap-2 truncate text-ui-lg font-medium">
                            <ProviderIcon
                              icon={draft.icon}
                              variant="color"
                              className="size-3 text-muted-foreground"
                            />
                            {draft.name}
                          </h2>
                          <div className="flex items-center gap-2">
                            <Switch
                              size="provider"
                              ariaLabel={t("services.providerEnabled")}
                              disabled={pending}
                              checked={draft.enabled !== false}
                              onCheckedChange={(enabled) => updateDraft({ ...draft, enabled })}
                            />
                            <Menu.DropdownMenu>
                              <Menu.DropdownMenuTrigger asChild>
                                <Button
                                  disabled={pending}
                                  aria-label={t("services.actions")}
                                  variant="ghost"
                                  size="icon"
                                >
                                  <Ellipsis />
                                </Button>
                              </Menu.DropdownMenuTrigger>
                              <Menu.DropdownMenuContent
                                align="end"
                                className="model-services-menu model-services-provider-menu"
                              >
                                <Menu.DropdownMenuItem
                                  onSelect={() => {
                                    setRename(draft.name);
                                    changeDialog("rename");
                                  }}
                                >
                                  <Pencil className="size-3" />
                                  {t("services.rename")}
                                </Menu.DropdownMenuItem>
                                {selected?.hasCredential ? (
                                  <Menu.DropdownMenuCheckboxItem
                                    checked={removeKey}
                                    onCheckedChange={(checked) => {
                                      clearRevealedKey();
                                      removeKeyRef.current = checked;
                                      setRemoveKey(checked);
                                      updateDraft(draft);
                                    }}
                                  >
                                    {t("services.keyDelete")}
                                  </Menu.DropdownMenuCheckboxItem>
                                ) : null}
                                <Menu.DropdownMenuItem
                                  aria-label={t("services.deleteProvider")}
                                  className="text-danger"
                                  onSelect={() => changeDialog("delete")}
                                >
                                  <Trash2 className="size-3" />
                                  {t("services.delete")}
                                </Menu.DropdownMenuItem>
                              </Menu.DropdownMenuContent>
                            </Menu.DropdownMenu>
                          </div>
                        </div>
                        <Input
                          size="scoped"
                          disabled={pending}
                          label={t("services.url")}
                          value={draft.baseUrl}
                          placeholder="https://api.example.com/v1"
                          onChange={(baseUrl) => updateDraft({ ...draft, baseUrl }, true)}
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
                                updateDraft({
                                  ...draft,
                                  api,
                                  ...structuredClone(createdPreset.current?.variants[api] ?? {}),
                                });
                            }}
                          >
                            <SelectTrigger
                              size="scoped"
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
                        <div className="model-services-provider-key-field relative">
                          {createdPreset.current ? (
                            <a
                              href={createdPreset.current.apiKeyUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="absolute right-0 top-0 cursor-pointer text-ui-base text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                            >
                              {t("services.getApiKey")}
                            </a>
                          ) : null}
                          <Input
                            size="scoped"
                            disabled={pending}
                            label={t("services.key")}
                            classNames={{ input: "model-services-key-input" }}
                            type={showKey ? "text" : "password"}
                            autoComplete="off"
                            value={showKey && revealedKey ? revealedKey : key}
                            placeholder={
                              selected?.hasCredential ? "••••••••" : t("services.keyPlaceholder")
                            }
                            rightIcon={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="model-services-key-toggle"
                                disabled={pending}
                                aria-label={t(
                                  showKey || revealing ? "services.hideKey" : "services.showKey",
                                )}
                                aria-pressed={showKey}
                                onClick={() => void toggleKey()}
                              >
                                {showKey ? <EyeOff /> : <Eye />}
                              </Button>
                            }
                            onChange={(value) => {
                              revealRequest.current++;
                              setRevealedKey("");
                              setRevealing(false);
                              keyRef.current = value;
                              removeKeyRef.current = false;
                              setRemoveKey(false);
                              setKey(value);
                              updateDraft(draft, true);
                            }}
                          />
                        </div>
                        {selected?.hasCredential ? (
                          <>
                            <p className="sr-only">{t("services.keyKeep")}</p>
                          </>
                        ) : null}
                        <div className="model-services-model-heading flex items-center justify-between gap-2">
                          <h3 className="font-medium">{t("services.models")}</h3>
                          <Button variant="secondary" size="contextual" onClick={() => openModel()}>
                            <Plus className="size-3" />
                            {t("services.addModel")}
                          </Button>
                        </div>
                        {!draft.models.length ? (
                          <p className="model-services-empty text-ui-base text-muted-foreground">
                            <Info className="size-3 shrink-0" />
                            {t("services.empty")}
                          </p>
                        ) : (
                          draft.models.map((item, index) => (
                            <div key={item.id} className="model-services-model-row">
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-mono">{item.name || item.id}</p>
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
                                size="provider"
                                ariaLabel={t("services.enabled")}
                                checked={item.enabled !== false}
                                disabled={pending}
                                onCheckedChange={(enabled) =>
                                  updateDraft({
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
                                disabled={pending}
                                onClick={() => void testConnection(item.id)}
                              >
                                <Unplug />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={t("services.edit")}
                                onClick={() => openModel(index)}
                              >
                                <Pencil />
                              </Button>
                              <Button
                                size="icon"
                                aria-label={t("services.deleteModel")}
                                variant="ghost"
                                disabled={pending}
                                onClick={() =>
                                  updateDraft({
                                    ...draft,
                                    models: draft.models.filter((_, i) => i !== index),
                                  })
                                }
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          ))
                        )}
                      </div>
                    ) : (
                      <Button size="compact" variant="secondary" onClick={() => setCatalog(true)}>
                        {t("services.addProvider")}
                      </Button>
                    )}
                  </ScrollArea>
                </>
              )}
            </div>
          </div>
        )}
      </ScrollArea>
      <MorphingModal
        geometry="settings"
        padding={dialog === "model" ? "none" : "settings"}
        label={
          dialog === "model"
            ? t(editing === undefined ? "services.addModel" : "services.editModel")
            : dialog === "rename"
              ? t("services.rename")
              : t("services.deleteTitle", { name: draft?.name ?? "" })
        }
        viewId={dialog}
        onClose={() => {
          if (!pending) changeDialog(null);
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
                onClick={() => changeDialog(null)}
              >
                <X />
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
                  size="scoped"
                  label={t("services.id")}
                  placeholder={t("services.id")}
                  autoFocus
                  value={model.id}
                  onChange={(id) => {
                    priceRequest.current++;
                    activePriceIdentity.current = "";
                    attemptedPriceIdentity.current = "";
                    setPriceLoading(false);
                    setPriceStatus("");
                    const next = { ...model, id };
                    for (const field of priceFields)
                      if (autoPrices.current.has(field) && !priceTouched.current.has(field))
                        next[field] = undefined;
                    if (
                      autoPrices.current.has("priceSource") &&
                      !priceTouched.current.has("priceSource")
                    )
                      next.priceSource = undefined;
                    autoPrices.current.clear();
                    setModel(next);
                  }}
                  onBlur={() => void fillPrices(model)}
                />
                <div className="model-services-basic-columns">
                  <Input
                    size="scoped"
                    label={t("services.displayName")}
                    value={model.name ?? ""}
                    onChange={(name) => setModel({ ...model, name })}
                  />
                  <Input
                    size="scoped"
                    label={t("services.context")}
                    type="number"
                    min={1}
                    value={String(model.contextWindow ?? "")}
                    onChange={(value) => setModel({ ...model, contextWindow: Number(value) })}
                  />
                </div>
              </section>
              <section className="model-services-reasoning">
                <h3 id="model-services-reasoning-label" className="text-ui-base">
                  {t("services.reasoningCapabilities")}
                </h3>
                <RadioGroup
                  aria-labelledby="model-services-reasoning-label"
                  orientation="horizontal"
                  value={model.reasoning ? "reasoning" : "off"}
                  onValueChange={(value) =>
                    setModel({
                      ...model,
                      reasoning: value === "reasoning",
                      defaultThinkingLevel:
                        value === "reasoning" ? model.defaultThinkingLevel : undefined,
                    })
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
                      {MODEL_SERVICE_THINKING_LEVELS.map((level) => (
                        <Checkbox
                          key={level}
                          label={reasoningLabels[level]}
                          checked={model.reasoning === true && supportedLevels.includes(level)}
                          disabled={!model.reasoning}
                          onCheckedChange={(enabled) => {
                            const next =
                              level === "automatic"
                                ? { ...model, automaticReasoning: enabled }
                                : {
                                    ...model,
                                    thinkingLevelMap: {
                                      ...model.thinkingLevelMap,
                                      [level]: enabled ? level : null,
                                    },
                                  };
                            if (
                              next.defaultThinkingLevel &&
                              !modelServiceThinkingLevels(next).includes(next.defaultThinkingLevel)
                            )
                              delete next.defaultThinkingLevel;
                            setModel(next);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <div
                    className="model-services-default-reasoning"
                    onKeyDownCapture={(event) => {
                      if (event.key === "Escape" && defaultReasoningOpen) {
                        event.stopPropagation();
                        setDefaultReasoningOpen(false);
                      }
                    }}
                  >
                    <p className="text-ui-sm text-muted-foreground">
                      {t("services.defaultReasoning")}
                    </p>
                    <Select
                      open={defaultReasoningOpen}
                      onOpenChange={setDefaultReasoningOpen}
                      value={model.defaultThinkingLevel ?? ""}
                      disabled={!model.reasoning}
                      onValueChange={(value) => {
                        const level = supportedLevels.find((item) => item === value);
                        if (!level) return;
                        const next = { ...model, defaultThinkingLevel: level };
                        setModel(next);
                      }}
                    >
                      <SelectTrigger size="scoped" aria-label={t("services.defaultReasoning")}>
                        {model.defaultThinkingLevel
                          ? reasoningLabels[model.defaultThinkingLevel]
                          : t("services.selectReasoning")}
                      </SelectTrigger>
                      <SelectContent className="model-services-menu model-services-reasoning-menu">
                        {supportedLevels.map((level) => (
                          <SelectItem key={level} value={level}>
                            {reasoningLabels[level]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
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
              <p className="sr-only" id="model-services-unsupported">
                {t("services.unsupported")}
              </p>
              <div className="model-services-advanced-shell">
                <Button
                  variant="ghost"
                  size="contextual"
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
                  <ChevronDown className="ml-auto size-3" />
                </Button>
                <div className="model-services-advanced" hidden={!advanced}>
                  <div className="model-services-advanced-columns">
                    <section className="model-services-option-card">
                      <h3>{t("services.compression")}</h3>
                      <Input
                        size="scoped"
                        label={t("services.compressionThreshold")}
                        type="number"
                        min={1}
                        max={100}
                        placeholder="%"
                        value={
                          advancedDraft.compressionThreshold ??
                          String(model.compressionThreshold ?? "")
                        }
                        onChange={(value) => editAdvanced("compressionThreshold", value)}
                      />
                    </section>
                    <section className="model-services-option-card">
                      <h3>{t("services.runtime")}</h3>
                      <div className="model-services-basic-columns">
                        <Input
                          size="scoped"
                          label="Temperature"
                          type="number"
                          min={0}
                          max={2}
                          step="any"
                          value={advancedDraft.temperature ?? String(model.temperature ?? "")}
                          onChange={(value) => editAdvanced("temperature", value)}
                        />
                        <Input
                          size="scoped"
                          label={t("services.tokens")}
                          type="number"
                          min={1}
                          value={String(model.maxTokens ?? "")}
                          onChange={(value) => setModel({ ...model, maxTokens: Number(value) })}
                        />
                      </div>
                      <Input
                        size="scoped"
                        label={t("services.toolIterations")}
                        type="number"
                        min={1}
                        value={
                          advancedDraft.maxToolIterations ?? String(model.maxToolIterations ?? "")
                        }
                        onChange={(value) => editAdvanced("maxToolIterations", value)}
                      />
                    </section>
                  </div>
                  <section className="model-services-option-card">
                    <h3 className="truncate" title={priceStatus || undefined}>
                      {t("services.price")}
                      {priceStatus ? (
                        <span role="status" className="text-ui-sm text-muted-foreground">
                          {" "}
                          · {priceStatus}
                        </span>
                      ) : null}
                    </h3>
                    <div className="model-services-price-columns">
                      {(
                        ["inputPrice", "outputPrice", "cacheReadPrice", "cacheWritePrice"] as const
                      ).map((field) => (
                        <Input
                          size="scoped"
                          key={field}
                          label={t(`services.${field}`)}
                          type="number"
                          min={0}
                          step="any"
                          value={advancedDraft[field] ?? String(model[field] ?? "")}
                          onChange={(value) => editAdvanced(field, value)}
                        />
                      ))}
                    </div>
                    <Input
                      size="scoped"
                      label={t("services.priceSource")}
                      value={model.priceSource ?? ""}
                      onChange={(priceSource) => {
                        priceTouched.current.add("priceSource");
                        setModel({ ...model, priceSource: priceSource || undefined });
                      }}
                    />
                  </section>
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
                size="contextual"
                onClick={() => changeDialog(null)}
                disabled={pending}
              >
                {t("services.cancel")}
              </Button>
              <Button
                className="model-services-model-save cursor-pointer disabled:pointer-events-auto disabled:cursor-not-allowed"
                type="submit"
                size="contextual"
                disabled={pending || dialogPending || priceLoading}
                aria-busy={dialogPending || priceLoading}
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
              if (!draft || dialogSubmission.current === dialogIdentity.current) return;
              const identity = dialogIdentity.current;
              dialogSubmission.current = identity;
              setDialogPending(true);
              const next = { ...draft, name: rename };
              draftRef.current = next;
              setDraft(next);
              revision.current++;
              void persist(next, undefined, identity).then((saved) => {
                if (dialogIdentity.current !== identity) return;
                dialogSubmission.current = undefined;
                setDialogPending(false);
                if (saved) changeDialog(null);
              });
            }}
          >
            <h2 className="font-medium">{t("services.rename")}</h2>
            <Input
              size="scoped"
              autoFocus
              label={t("services.name")}
              value={rename}
              onChange={setRename}
            />
            <div className="flex justify-end gap-2">
              <Button size="compact" variant="ghost" onClick={() => changeDialog(null)}>
                {t("services.cancel")}
              </Button>
              <Button size="compact" type="submit" disabled={pending || dialogPending}>
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
                size="compact"
                variant="secondary"
                aria-label={t("services.cancel")}
                onClick={() => changeDialog(null)}
                disabled={pending}
              >
                {t("services.cancel")}
              </Button>
              <Button
                size="compact"
                variant="destructive"
                aria-label={t("services.confirm")}
                data-confirm-delete
                disabled={pending}
                onClick={() => {
                  if (!draft) return;
                  setPending(true);
                  const providerId = draft.id;
                  void flush();
                  void writes.current
                    .then(() => services.delete(providerId))
                    .then(async () => {
                      changeDialog(null);
                      draftRef.current = undefined;
                      setDraft(undefined);
                      setProviders(await services.list());
                      try {
                        await onChanged();
                      } catch {
                        setError(t("services.refreshFailure"));
                      }
                      clearRevealedKey();
                      setKey("");
                    })
                    .catch(() => setError(t("services.saveFailure")))
                    .finally(() => setPending(false));
                }}
              >
                {t("services.confirm")}
                <CornerDownLeft aria-hidden="true" className="size-3" />
              </Button>
            </div>
          </div>
        )}
      </MorphingModal>
    </section>
  );
}
