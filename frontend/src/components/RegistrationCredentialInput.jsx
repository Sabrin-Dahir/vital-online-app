import { useEffect, useRef, useState } from "react";

/**
 * Credential inputs for "create someone else's account" forms.
 *
 * Root cause of Admin email/password appearing in Register Coach/User:
 * the browser password manager treats type=email + type=password as a login
 * form and injects the logged-in Admin's saved credentials. Application React
 * state already started empty — Chrome/password managers filled the fields.
 *
 * This control:
 * - never reads AuthContext / localStorage for values
 * - uses registration autocomplete tokens (new-email / new-password)
 * - stays read-only until focused (blocks autofill-on-load)
 * - uses unique names so it does not match the Admin login fields
 * - asks password managers to ignore the field
 */
export function RegistrationCredentialInput({
  value,
  onChange,
  className,
  type = "text",
  autoComplete = "off",
  name,
  id,
  onFocus,
  onBlur,
  ...rest
}) {
  const [unlocked, setUnlocked] = useState(false);

  return (
    <input
      {...rest}
      id={id || name}
      name={name}
      type={type}
      value={value}
      className={className}
      autoComplete={autoComplete}
      autoCorrect="off"
      autoCapitalize="none"
      spellCheck={false}
      readOnly={!unlocked}
      data-form-type="other"
      data-lpignore="true"
      data-1p-ignore="true"
      data-bwignore="true"
      onFocus={(event) => {
        setUnlocked(true);
        onFocus?.(event);
      }}
      onBlur={onBlur}
      onChange={onChange}
      onInput={onChange}
    />
  );
}

/**
 * Fresh empty registration state that is re-cleared shortly after mount so
 * delayed browser autofill cannot leave Admin credentials in the form.
 *
 * Autofill often fires `onChange` without a real user focus. Only a focus
 * (the Admin typing) counts as interaction and stops the scrub.
 * `createEmpty` must be a stable module-level factory (not an inline arrow).
 */
export function useFreshRegistrationForm(createEmpty) {
  const [form, setFormState] = useState(createEmpty);
  const interactedRef = useRef(false);

  useEffect(() => {
    interactedRef.current = false;
    setFormState(createEmpty());
    const timers = [50, 200, 500].map((ms) =>
      setTimeout(() => {
        if (!interactedRef.current) setFormState(createEmpty());
      }, ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [createEmpty]);

  function markEdited() {
    interactedRef.current = true;
  }

  function setField(key, value) {
    setFormState((current) => ({ ...current, [key]: value }));
  }

  function resetForm() {
    interactedRef.current = false;
    setFormState(createEmpty());
  }

  function setForm(updater) {
    setFormState(updater);
  }

  return { form, setForm, setField, resetForm, markEdited };
}
