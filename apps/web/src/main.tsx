import { ApolloProvider } from "@apollo/client";
import { createGraphQLClient } from "@vital-forge/shared-logic";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const client = createGraphQLClient(import.meta.env.VITE_GRAPHQL_URL ?? "http://localhost:4000/graphql");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><ApolloProvider client={client}><App /></ApolloProvider></React.StrictMode>
);
