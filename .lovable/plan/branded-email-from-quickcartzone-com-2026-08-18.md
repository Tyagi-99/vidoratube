# Branded email from quickcartzone.com

Goal: emails Vidora sends (password reset, signup confirmation, magic links, and later app notifications) arrive from your own domain instead of a generic sender, so they look legitimate and stay out of spam.

## Important: Resend can't be used here

Your app's backend runs on Lovable Cloud, and its SMTP settings are not editable — there's no field to paste Resend credentials into. Instead, Lovable's own email service handles sending, and it authenticates mail from your domain properly (SPF, DKIM, DMARC set up automatically). You can keep your Resend account for other things, but it won't power this app's emails.

## What you do

1. Approve this plan, and I'll open the email setup dialog for `quickcartzone.com`.
2. The dialog gives you a small set of NS records for a sending subdomain (something like `notify.quickcartzone.com`).
3. You add those records in Hostinger's DNS zone editor for the domain.
4. Verification runs automatically — usually minutes, up to 72 hours worst case. Status is visible in Cloud → Emails.

Note: don't add Resend's SPF/DKIM records on the same subdomain — the two would conflict.

## What I do

- Trigger the domain setup for `quickcartzone.com`.
- Scaffold the six authentication email templates (signup confirmation, password reset, magic link, invite, email change, reauthentication) and the route that sends them.
- Style all templates to match Vidora's brand: Aperture logo mark, teal/mint accent colors, Sora headings and Manrope body text, on a white email background.
- Set the sender name to Vidora AI so recipients see a branded "From" line.
- Confirm the auth flows (especially the existing forgot-password page) point at the branded emails.

## Technical notes

- Auth templates live in `src/lib/email-templates/`, with the auth webhook route at `src/routes/lovable/email/auth/webhook.ts`; sending goes through Lovable's managed email API using the project's existing API key — no new secrets needed.
- Packages added if missing: `@lovable.dev/email-js`, `@lovable.dev/webhooks-js`, `@react-email/components`, `@react-email/render`.
- Auth email hourly rate limit can be raised once sending is active, if signup volume needs it.
- No database changes, no queue tables, no changes to the video pipeline or existing UI.

## Optional follow-up

Once the domain verifies, I can also add app emails from your domain — e.g. a confirmation to people who submit the contact form, and a notification to you when one arrives. Say the word and I'll add it after setup.
