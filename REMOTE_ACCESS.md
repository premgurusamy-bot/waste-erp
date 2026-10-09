# Open GreenCycle from anywhere + Sign in with Google

GreenCycle runs on the office computer. These two optional steps let staff open it on any phone or laptop,
anywhere, over mobile data or any Wi-Fi, and sign in with their Gmail account.

## 1. Open from anywhere (Cloudflare Tunnel)

What you need: a domain name (about ₹700–1,000 a year, from any registrar) added to a **free** Cloudflare account
(dash.cloudflare.com → Add a site → follow the steps to change the domain's nameservers).

On the office computer:
1. Double-click **SETUP-REMOTE-ACCESS.bat** and click **Yes**.
2. A browser opens: sign in to Cloudflare, pick your domain, click **Authorize**.
3. Type the address staff will use, e.g. `erp.yourcompany.in`.
4. Answer **Y** to start GreenCycle automatically with Windows.
5. In GreenCycle: **Settings → Remote & Google Sign-in → Public web address** = `https://erp.yourcompany.in` → Save.

Now `https://erp.yourcompany.in` works anywhere. Nothing is opened on your router; the connection is encrypted (HTTPS).
The office computer must stay **on**, with GreenCycle running (set Windows power options so it never sleeps).

Phones: in the app tap your name → **App settings**, change the server address to `erp.yourcompany.in`, **Save and connect**.

## 2. Sign in with Google

1. Go to **console.cloud.google.com** with your Gmail and create a project called *GreenCycle*.
2. **APIs & Services → OAuth consent screen**: User type *External*; app name *GreenCycle*; your email; Save. Then **Publish app**.
3. **Credentials → Create credentials → OAuth client ID** → *Web application*.
   Under **Authorised redirect URIs** add: `https://erp.yourcompany.in/api/auth/google/callback` (your address).
4. Copy the **Client ID** and **Client secret** into **Settings → Remote & Google Sign-in** → Save.
5. In **Users & Roles**, put each person's Gmail address in their **Email**.

The sign-in page now shows **Sign in with Google**. Only Gmail addresses that belong to an active GreenCycle user
can sign in; anyone else sees "not registered". Usernames and passwords keep working. In the Android app,
Google sign-in opens in Chrome and then returns to the app automatically.

## Problems

| Problem | Fix |
|---|---|
| `https://erp…` shows a Cloudflare error 1033 / 502 | The office computer is off, or GreenCycle (START-WINDOWS) is not running. |
| "redirect_uri_mismatch" from Google | The redirect URI in Google Cloud must exactly match `https://<your address>/api/auth/google/callback`. |
| "… is not registered in GreenCycle" | Put that Gmail address in the user's **Email** in Users & Roles. |
| "Access blocked: app has not completed verification" / only test users can sign in | On the OAuth consent screen click **Publish app**. |
| Google sign-in button missing | Fill all three fields in Settings → Remote & Google Sign-in. |
| Phone app opens Chrome but does not come back | Update the phone app to version 1.1 (download again from `/mobile`), then tap **Open GreenCycle app**. |
| Works on Wi-Fi but not on mobile data | The phone app still uses the 192.168… address: change it to your public address in App settings. |

Security: the sign-in page is now on the internet, so give every user a strong password. Five wrong passwords lock
the account for 15 minutes, and every sign-in (including Google) is recorded in the Audit Trail.
