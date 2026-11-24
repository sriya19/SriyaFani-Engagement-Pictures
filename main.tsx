import React from "react";
import { createRoot } from "react-dom/client";
import Album from "./components/album/Album";
import "./app/globals.css";
createRoot(document.getElementById("root")!).render(
  <Album hostPage={/^\/host\/?$/.test(location.pathname)} />,
);
