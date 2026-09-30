// Fuentes servidas desde el propio panel (C51): sin petición a Google Fonts, sin
// enviar la IP del personal a terceros y funcionan sin conexión externa. Solo latín.
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-400-italic.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-600.css";
import "@fontsource/space-grotesk/latin-700.css";
import { ApolloProvider } from "@apollo/client";
import { createGraphQLClient } from "@vital-forge/shared-logic";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ConfirmProvider } from "./components/common/ConfirmDialog";
import { UnsavedChangesProvider } from "./components/common/UnsavedChanges";
import "./styles.css";
import "./workspace.css";
import "./features/business/business.css";
const client = createGraphQLClient(import.meta.env.VITE_GRAPHQL_URL ?? "http://localhost:4000/graphql");
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><ApolloProvider client={client}><ConfirmProvider><UnsavedChangesProvider><App/></UnsavedChangesProvider></ConfirmProvider></ApolloProvider></React.StrictMode>);
