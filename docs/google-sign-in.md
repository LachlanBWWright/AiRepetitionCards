# Google sign-in

Google is the only Recall account sign-in method. Web uses a Supabase SSR session;
Electron and mobile open the system browser and use PKCE to exchange the callback
code for a securely stored session. Offline native study still needs no account.
The ChatGPT connection in tutor settings is separate from the Recall account.

## Hosted setup

1. Create a Google Cloud project and configure Google Auth Platform branding,
   audience and contact information. Use only the basic OpenID, email and profile
   scopes. During testing, add each permitted Google account as a test user;
   publish the app's audience when it should accept other Google accounts.
2. Create an OAuth client of type **Web application**. Add
   `https://recall-repetition-learning.vercel.app` as an authorized JavaScript
   origin and `https://susfichajhjyupjglzrz.supabase.co/auth/v1/callback` as an
   authorized redirect URI. Native clients use this same hosted Supabase flow.
3. In Recall's Supabase project, enable the Google provider and save this client's
   ID and secret. The secret belongs in Supabase, never in app bundles or Git.
4. Set Supabase's Site URL to `https://recall-repetition-learning.vercel.app`.
   Allow `https://recall-repetition-learning.vercel.app/auth/confirm` and
   `recall://auth/confirm` as redirect URLs. The hosted Email provider remains
   enabled by choice; the Recall apps offer Google as their only sign-in control.
5. Deploy the web changes and rebuild native packages. Existing native APKs that
   contain email sign-in must be replaced. Existing sessions are not erased by
   changing the sign-in screen. Supabase can link Google to an existing account
   with the same verified email; check the existing library before creating data
   under another Google account.

No Google secret is needed in Vercel, Render, Electron or Expo. The Supabase URL
and publishable key use the existing platform configuration. The obsolete
`RECALL_OAUTH_PROVIDERS` setting is no longer used.

## Local development

Use a separate Google OAuth client for development. Register
`http://127.0.0.1:54321/auth/v1/callback` and the local web origin. Put its client ID and secret in the ignored root `.env` as
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET`. Restart local Supabase after
changing provider configuration. Local email fixtures may still be used by API
acceptance scripts, but there is no email sign-in control in the apps.

## Acceptance

Check that the sole account sign-in button opens Google and that cancellation
returns a useful retry message. Complete sign-in on web, check the saved library,
and sign out. Repeat using packaged Android and Electron builds, including a
cold-start callback. Callback codes must be exchanged by the client that started
the flow: another device, expired code, duplicate parameters and legacy token
hash links must not create a session.

See [Supabase's Google setup guide](https://supabase.com/docs/guides/auth/social-sign-in/auth-google).
