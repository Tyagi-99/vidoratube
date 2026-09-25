/**
 * Legal entity configuration.
 *
 * All fields default to empty until the founder fills them in
 * (see docs/FOUNDER_TODO.md). Public pages must NEVER render "[FILL]" or
 * placeholder text — they fall back to neutral wording ("Vidora AI",
 * "governing law: India") via the helpers below.
 *
 * Decision recorded in docs/DECISIONS.md.
 */

export interface LegalConfig {
  /** Full legal name, e.g. "Acme Private Limited" or "<Name>, sole proprietor". */
  entityName: string;
  /** Public brand name. */
  tradingName: string;
  /** Registered address: city, state, India. */
  registeredAddress: string;
  /** Governing law jurisdiction. */
  governingLaw: string;
  /** Courts of which city have jurisdiction. */
  courtCity: string;
  /** DPDP Act / IT Rules grievance officer name. */
  grievanceName: string;
  /** Grievance officer email (must be on a domain we control). */
  grievanceEmail: string;
  /** Grievance officer postal address. */
  grievancePostal: string;
}

export const legalConfig: LegalConfig = {
  entityName: "",
  tradingName: "Vidora AI",
  registeredAddress: "",
  governingLaw: "India",
  courtCity: "",
  grievanceName: "",
  grievanceEmail: "",
  grievancePostal: "",
};

/** Public brand name — always safe to render. */
export function brandName(): string {
  return legalConfig.tradingName || "Vidora AI";
}

/**
 * Neutral entity line for Terms. Never shows "[FILL]".
 * When the entity is unknown we say "Vidora AI" without claiming a legal form.
 */
export function entityLine(): string {
  if (legalConfig.entityName) {
    const addr = legalConfig.registeredAddress ? `, ${legalConfig.registeredAddress}` : "";
    return `${legalConfig.entityName}${addr}`;
  }
  return brandName();
}

/** "governing law: India" style line; falls back to India. */
export function governingLawLine(): string {
  const law = legalConfig.governingLaw || "India";
  const courts = legalConfig.courtCity ? ` Courts: ${legalConfig.courtCity}, India.` : "";
  return `Governing law: ${law}.${courts}`;
}

/** True when grievance officer details are configured. */
export function hasGrievanceOfficer(): boolean {
  return Boolean(legalConfig.grievanceName && legalConfig.grievanceEmail);
}
