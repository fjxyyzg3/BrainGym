export function registryClient(options: {
  origin: string;
  token: string;
  hubId: string;
  protocolVersion?: string;
}): Promise<{
  call(
    method: string,
    payload?: Record<string, unknown>,
    timeout?: number,
  ): Promise<unknown>;
  protocolVersion: string;
  close(): void;
}>;
