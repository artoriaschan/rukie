import {
  McpOAuthProvider,
  type McpOAuthProviderOptions,
  type OAuthDiscoveryState,
  type OAuthFlowOptions,
} from "@earendil-works/pi-mcp/oauth";
import { Type } from "typebox";
import { Value } from "typebox/value";

const Strings = Type.Array(Type.String());
export const OAuthMetadata = Type.Object({
  issuer: Type.String(),
  authorization_endpoint: Type.String(),
  token_endpoint: Type.String(),
  response_types_supported: Strings,
  registration_endpoint: Type.Optional(Type.String()),
  scopes_supported: Type.Optional(Strings),
  grant_types_supported: Type.Optional(Strings),
  token_endpoint_auth_methods_supported: Type.Optional(Strings),
  code_challenge_methods_supported: Type.Optional(Strings),
  client_id_metadata_document_supported: Type.Optional(Type.Boolean()),
});

/** Apply Neant's configured client authentication method to every token request. */
export function createOAuthProvider(options: McpOAuthProviderOptions) {
  const provider = new McpOAuthProvider(options);
  const { clientId, clientSecret } = options;
  if (!clientId || !clientSecret) return provider;
  return Object.assign(provider, {
    addClientAuthentication(_headers: Headers, parameters: URLSearchParams) {
      parameters.set("client_id", clientId);
      parameters.set("client_secret", clientSecret);
    },
  });
}

/** A configured metadata URL replaces discovery while pi still owns the protocol flow. */
export function configureOAuthMetadata(
  provider: McpOAuthProvider,
  metadataUrl: string | undefined,
  fetchMetadata: NonNullable<OAuthFlowOptions["fetch"]> = fetch,
) {
  if (!metadataUrl) return;
  let discovery: OAuthDiscoveryState | undefined;
  // Do not contact an authorization server until the MCP endpoint actually requests OAuth.
  provider.discoveryState = async () => {
    if (discovery) return discovery;
    const response = await fetchMetadata(metadataUrl);
    if (!response.ok)
      throw new Error(`OAuth authorization metadata failed with status ${response.status}.`);
    const metadata: unknown = await response.json();
    if (!Value.Check(OAuthMetadata, metadata))
      throw new Error("Invalid OAuth authorization server metadata.");
    for (const endpoint of [
      metadata.issuer,
      metadata.authorization_endpoint,
      metadata.token_endpoint,
      metadata.registration_endpoint,
    ]) {
      if (endpoint === undefined) continue;
      const url = new URL(endpoint);
      if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new Error("Invalid OAuth authorization server endpoint.");
    }
    discovery = { authorizationServerUrl: metadata.issuer, authorizationServerMetadata: metadata };
    return discovery;
  };
}
