import { useEffect, useState } from "react";
import { Smartphone, Share, SquarePlus, EllipsisVertical, X } from "lucide-react";

// "Add Defied to your phone" (2026-11-11, the owner: "can we make this so that clients and co managers can add it
// from their phones easily from their portal"): on a phone, at the top of the portal and the dashboard, until the
// site is opened from the home screen or the card is put away. Chrome (Android) installs it with one tap
// (beforeinstallprompt, public/manifest.webmanifest); Safari has no such button, so an iPhone gets the two taps
// (Share, then Add to Home Screen); any other browser, its menu. Put away is remembered on this phone only.
const KEY = "defied-install-card";
const remembered = () => { try { return localStorage.getItem(KEY) === "done"; } catch { return false; } };
const remember = () => { try { localStorage.setItem(KEY, "done"); } catch { /* storage blocked: shows again next time */ } };
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
const phone = () => (window.matchMedia?.("(pointer: coarse)").matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) && Math.min(window.screen?.width || 9999, window.innerWidth) <= 1024;
const apple = () => /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// a beforeinstallprompt can fire before the card is drawn (it's on the dashboard's lazy sections): kept here
let early = null;
if (typeof window !== "undefined") window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); early = e; });

export function InstallApp() {
  const [show, setShow] = useState(false);
  const [prompt, setPrompt] = useState(null);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    if (standalone() || remembered() || !phone()) return;
    setIos(apple());
    setShow(true);
    if (early) setPrompt(early);
    const got = (e) => { e.preventDefault(); early = e; setPrompt(e); };
    const done = () => { remember(); setShow(false); };
    window.addEventListener("beforeinstallprompt", got);
    window.addEventListener("appinstalled", done);
    return () => { window.removeEventListener("beforeinstallprompt", got); window.removeEventListener("appinstalled", done); };
  }, []);
  if (!show) return null;
  const close = () => { remember(); setShow(false); };
  const install = async () => {
    prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    early = null; setPrompt(null);
    if (choice?.outcome === "accepted") close();
  };
  return (
    <div className="install-card" role="region" aria-label="Add Defied to your phone" data-install={prompt ? "prompt" : ios ? "ios" : "menu"}>
      <span className="install-icon" aria-hidden="true"><Smartphone size={18} /></span>
      <div className="install-text">
        <b>Add Defied to your phone</b>
        {prompt ? <span>Opens full screen from your home screen, like an app.</span>
          : ios ? <span>Tap <Share size={14} aria-label="Share" className="install-glyph" /> Share at the bottom of Safari, then <SquarePlus size={14} aria-hidden="true" className="install-glyph" /> <b>Add to Home Screen</b>.</span>
            : <span>Open your browser's menu <EllipsisVertical size={14} aria-label="menu" className="install-glyph" /> and tap <b>Add to Home screen</b> or <b>Install app</b>.</span>}
      </div>
      {prompt && <button type="button" className="btn sm install-go" onClick={install} data-install-go>Install</button>}
      <button type="button" className="install-close" onClick={close} aria-label="Not now" data-install-close><X size={16} /></button>
    </div>
  );
}
