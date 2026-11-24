import React from "react";
import { createRoot } from "react-dom/client";
import Album from "./components/album/Album";
import { configureGuestWebsite } from "./components/album/transport";
import "./app/globals.css";
const guestOnly = import.meta.env.MODE === "pages";
const homePath = import.meta.env.BASE_URL;
if (guestOnly) configureGuestWebsite(import.meta.env.VITE_ALBUM_API_ORIGIN, homePath);
if (!guestOnly && /^\/host\/?$/.test(location.pathname)) document.querySelector('link[rel="manifest"]')?.setAttribute("href", homePath + "host.webmanifest");
createRoot(document.getElementById("root")!).render(
  <Album homePath={homePath} guestOnly={guestOnly} hostPage={!guestOnly && /^\/host\/?$/.test(location.pathname)} />,
);
