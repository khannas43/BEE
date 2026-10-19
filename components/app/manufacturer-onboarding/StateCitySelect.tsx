"use client";

import { INDIAN_STATES_AND_UTS, citiesForState } from "@/lib/manufacturer-onboarding/indiaLocations";
import { WizardFieldLabel, wizardInputClass } from "./wizardChrome";

type Props = {
  state: string;
  city: string;
  onStateChange: (state: string) => void;
  onCityChange: (city: string) => void;
  stateTestId?: string;
  cityTestId?: string;
  stateRequired?: boolean;
};

export function StateCitySelect({
  state,
  city,
  onStateChange,
  onCityChange,
  stateTestId = "field-address-state",
  cityTestId = "field-address-city",
  stateRequired,
}: Props) {
  const cityOptions = citiesForState(state);

  return (
    <>
      <label className="block">
        <WizardFieldLabel required={stateRequired}>State</WizardFieldLabel>
        <select
          className={wizardInputClass}
          value={state}
          onChange={(e) => onStateChange(e.target.value)}
          data-testid={stateTestId}
          aria-label="State"
        >
          <option value="">Select state</option>
          {INDIAN_STATES_AND_UTS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <WizardFieldLabel>City</WizardFieldLabel>
        <select
          className={wizardInputClass}
          value={city}
          disabled={!state}
          onChange={(e) => onCityChange(e.target.value)}
          data-testid={cityTestId}
          aria-label="City"
        >
          {!state ? (
            <option value="">Select state first</option>
          ) : cityOptions.length === 0 ? (
            <option value="">No cities listed</option>
          ) : (
            <>
              {!city ? <option value="">Select city</option> : null}
              {cityOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </>
          )}
        </select>
      </label>
    </>
  );
}
