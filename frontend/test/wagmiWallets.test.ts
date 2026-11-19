import { coreWallet, injectedWallet, metaMaskWallet } from '@rainbow-me/rainbowkit/wallets';
import { describe, expect, it } from 'vitest';
import { pickWallets } from '../lib/wagmi';

describe('pickWallets (avoid WalletConnect when an extension is installed)', () => {
  it('only the installed extensions + generic injected', () => {
    expect(pickWallets({ core: false, metaMask: true })).toEqual([metaMaskWallet, injectedWallet]);
    expect(pickWallets({ core: true, metaMask: false })).toEqual([coreWallet, injectedWallet]);
    expect(pickWallets({ core: true, metaMask: true })).toEqual([coreWallet, metaMaskWallet, injectedWallet]);
  });
  it('no extension (or server render): keep the WalletConnect-backed options so the user can still connect', () => {
    expect(pickWallets({ core: false, metaMask: false })).toEqual([coreWallet, metaMaskWallet, injectedWallet]);
    expect(pickWallets(null)).toEqual([coreWallet, metaMaskWallet, injectedWallet]);
  });
});
