"use client";
import { useEffect, useState } from "react";
import { api, Icon, Lotus, Me, Message, say } from "./shared";
export default function Access({
  me,
  refresh,
  hostPage = false,
}: {
  me: Me;
  refresh: () => Promise<Me>;
  hostPage?: boolean;
}) {
  const [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [country, setCountry] = useState("+1"),
    [code, setCode] = useState(""),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [cool, setCool] = useState(0);
  useEffect(() => {
    if (cool <= 0) return;
    const t = setTimeout(() => setCool((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cool]);
  const fullPhone =
    country === "other"
      ? "+" + phone.replace(/\D/g, "")
      : country + phone.replace(/\D/g, "");
  async function send() {
    setBusy(true);
    setMessage("");
    try {
      await api("otp/start", { name, phone: fullPhone });
      setSent(true);
      setCode("");
      setCool(60);
    } catch (e) {
      setMessage(say(e));
    } finally {
      setBusy(false);
    }
  }
  async function check() {
    setBusy(true);
    setMessage("");
    try {
      await api("otp/check", { code });
      await refresh();
    } catch (e) {
      setMessage(say(e));
    } finally {
      setBusy(false);
    }
  }
  if (me.role === "guest" && (hostPage || me.status !== "approved"))
    return (
      <div className="formBox">
        <Lotus className="formLotus" />
        <h2>
          {hostPage
            ? "Host access"
            : me.status === "pending"
              ? "Your number is verified"
              : "Album access"}
        </h2>
        <p>
          {hostPage
            ? "Please use the host account to open the studio."
            : me.status === "pending"
              ? "Thank you, " +
                (me.name || "friend") +
                ". Your album will appear here when access is ready."
              : "This number currently has no access to the album. Please contact Sriya or Fani."}
        </p>
        <div className="actions">
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const v = await refresh();
                if (v.status === me.status)
                  setMessage("Your access status is up to date.");
              } catch (e) {
                setMessage(say(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Check access
          </button>
          <button
            className="textButton"
            onClick={async () => {
              try {
                await api("logout", {});
                setSent(false);
                setCode("");
                setMessage("");
                await refresh();
              } catch (e) {
                setMessage(say(e));
              }
            }}
          >
            Use another number
          </button>
        </div>
        <Message value={message} />
      </div>
    );
  if (me.smsEnabled === false)
    return (
      <div className="formBox">
        <Lotus className="formLotus" />
        <h2>Guest access opens soon</h2>
        <p>Sriya and Fani are setting up text verification. Once it’s ready, you can enter your name and mobile number here to request access.</p>
        <button className="button light" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            if (!(await refresh()).smsEnabled) setMessage("Text verification is still being set up.");
          } catch (e) {
            setMessage(say(e));
          } finally {
            setBusy(false);
          }
        }}>Check again</button>
        <Message value={message} />
      </div>
    );
  return (
    <div className="formBox">
      <Lotus className="formLotus" />
      <p className="eyebrow">{hostPage ? "Host access" : "Private album"}</p>
      <h2>
        {sent
          ? "Check your messages"
          : hostPage
            ? "Host sign-in"
            : "Open the album"}
      </h2>
      <p>
        {sent
          ? "Enter the one-time code sent to " + fullPhone + "."
          : hostPage
            ? "Use your configured host mobile number to sign in."
            : "Enter your name and mobile number. We’ll text you a one-time code."}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) {
            if (sent) void check();
            else void send();
          }
        }}
      >
        {sent ? (
          <label>
            Verification code
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{4,10}"
              maxLength={10}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
        ) : (
          <>
            <label>
              Your name
              <input
                autoComplete="name"
                name="name"
                placeholder="First and last name"
                maxLength={80}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>Mobile number</label>
            <div className="phoneRow">
              <select
                aria-label="Country calling code"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                <option value="+1">US / CA +1</option>
                <option value="+91">India +91</option>
                <option value="+44">UK +44</option>
                <option value="+971">UAE +971</option>
                <option value="other">Other</option>
              </select>
              <input
                aria-label="Mobile number"
                autoComplete={country === "other" ? "tel" : "tel-national"}
                type="tel"
                inputMode="tel"
                placeholder={
                  country === "other"
                    ? "+ country code and number"
                    : "Mobile number"
                }
                value={phone}
                maxLength={24}
                required
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </>
        )}
        {!sent && (
          <p className="privacy">
            By continuing, you agree to receive a verification text. The hosts
            can see your access request, album favorites and original download
            requests.
          </p>
        )}
        <button className="button full" disabled={busy} type="submit">
          <Icon name="lock" />
          {busy ? "Please wait…" : sent ? "Verify code" : "Text me a code"}
        </button>
      </form>
      {sent && (
        <div className="actions">
          <button
            className="textButton"
            disabled={busy || cool > 0}
            onClick={send}
          >
            {cool > 0 ? "Resend in " + cool + "s" : "Resend code"}
          </button>
          <button
            className="textButton"
            disabled={busy}
            onClick={() => {
              setSent(false);
              setMessage("");
            }}
          >
            Change number
          </button>
        </div>
      )}
      <Message value={message} />
    </div>
  );
}
