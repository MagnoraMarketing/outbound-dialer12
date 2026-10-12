"use client";

import { Download, Share } from "lucide-react";
import { useEffect, useState } from "react";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// "Hent app": installs the page as an app on the phone or desktop. Chrome/Android
// get the native prompt; iOS has none, so Safari users get the Add to Home Screen steps.
export function InstallAppButton({ serviceWorker, scope }: { serviceWorker: string; scope: string }) {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosHelp, setIosHelp] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register(serviceWorker, { scope }).catch(() => undefined);
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIos(ios);
    // Opened by scanning the login QR code: show the iOS steps straight away.
    if (ios && new URLSearchParams(window.location.search).get("app") === "1") setIosHelp(true);
    const onPrompt = (event: Event) => { event.preventDefault(); setPromptEvent(event as InstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setPromptEvent(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [serviceWorker, scope]);

  if (installed || (!promptEvent && !isIos)) return null;
  return <span className="cp-install">
    <button type="button" className="button button-secondary button-small" onClick={async () => {
      if (promptEvent) {
        await promptEvent.prompt();
        await promptEvent.userChoice.catch(() => null);
        setPromptEvent(null);
      } else setIosHelp(!iosHelp);
    }}><Download size={14} /> Hent app</button>
    {iosHelp && <span className="cp-install-help" role="note">Tryk på <Share size={13} /> Del i Safari og vælg <strong>Føj til hjemmeskærm</strong>.</span>}
  </span>;
}
