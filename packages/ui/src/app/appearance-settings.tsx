import { useSyncExternalStore } from "react";
import { RadioGroup, RadioGroupItem } from "../components/motion/radio";
import { isAppearancePreference, type Appearance } from "../lib/appearance";
import { useAppText } from "../lib/i18n";

export function AppearanceSettings({ appearance }: { appearance: Appearance }) {
  const t = useAppText();
  const preference = useSyncExternalStore(appearance.subscribe, appearance.getSnapshot);
  return (
    <div className="model-services-workspace">
      <header className="model-services-header">
        <h1 className="text-ui-xl font-medium">{t("services.nav.appearance")}</h1>
        <p className="text-ui-base text-muted-foreground">{t("appearance.description")}</p>
      </header>
      <RadioGroup
        aria-label={t("appearance.theme")}
        value={preference}
        onValueChange={(value) => {
          if (isAppearancePreference(value)) appearance.setPreference(value);
        }}
      >
        <RadioGroupItem value="system" label={t("appearance.system")} />
        <RadioGroupItem value="light" label={t("appearance.light")} />
        <RadioGroupItem value="dark" label={t("appearance.dark")} />
      </RadioGroup>
    </div>
  );
}
