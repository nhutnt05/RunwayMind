/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@runwaymind/shared'],
  webpack: (config) => {
    // Optional peer deps pulled in by WalletConnect / MetaMask SDK that are not needed in the browser.
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    config.resolve.fallback = { ...config.resolve.fallback, '@react-native-async-storage/async-storage': false };
    // wagmi ≥ 2.17's baseAccount connector imports @coinbase/cdp-sdk, which references optional x402 payment
    // packages that are not installed. RunwayMind only uses Core / MetaMask / injected wallets, so stub them out.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@x402/core/client': false,
      '@x402/evm': false,
      '@x402/evm/exact/client': false,
      '@x402/evm/upto/client': false,
      '@x402/svm/exact/client': false,
    };
    return config;
  },
};

export default nextConfig;
