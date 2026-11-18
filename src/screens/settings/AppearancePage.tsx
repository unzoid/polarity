import { setPrefs, usePrefs } from "../../lib/settings";
import { Card, NumberRow } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";
import { ThemePicker } from "../../components/settings/ThemePicker";

export function AppearancePage() {
  const prefs = usePrefs();

  return (
    <>
      <ThemePicker />

      <Card title="Size">
        <NumberRow
          setting="uiScale"
          title="Interface size"
          caption="On this device."
          value={Math.round((prefs.uiScale > 0 ? prefs.uiScale : 1) * 100)}
          min={70}
          max={175}
          step={5}
          unit="%"
          onChange={(n) => setPrefs({ uiScale: n / 100 })}
        />
        <SettingRow id="cardSize" />
      </Card>

      <Card title="Text and Motion">
        <SettingRow id="uiFont" />
        <SettingRow id="reduceMotion" />
      </Card>
    </>
  );
}
