declare module "@x402/express" {
  export const paymentMiddleware: any;
  export const x402ResourceServer: any;
}

declare module "@x402/evm/exact/server" {
  export const ExactEvmScheme: any;
}

declare module "@x402/core/server" {
  export const HTTPFacilitatorClient: any;
}

declare module "@coinbase/cdp-sdk/x402" {
  export const createCdpFacilitatorClient: any;
}