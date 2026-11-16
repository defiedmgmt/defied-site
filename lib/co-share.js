// (2026-11-16, the owner) Defied's share of a co-managed client's payment ON THE ACCOUNTING SHEET is 33.3%, the manager's 66.7% (INFO's
// Manager Gets % is 0.667). The one place the sheet side reads it from: the Log it row's Manager Share, the share checks, My payments'
// share. It is NOT what Stripe took as Defied's fee, which has its own history (lib/stripe.js CO_CUTS). Pure, no imports: safe in the
// browser (lib/log-fields.js uses it), and lib/stripe.js exports it too, beside CO_MANAGER.
export const CO_DEFIED_SHARE = 0.333;
