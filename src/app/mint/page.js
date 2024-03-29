"use client";

import Image from "next/image";
import Link from "next/link";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useCallback } from "react";
import React from "react";

import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import "@solana/wallet-adapter-react-ui/styles.css";

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  base58PublicKey,
  generateSigner,
  Option,
  PublicKey,
  publicKey,
  SolAmount,
  some,
  transactionBuilder,
  Umi,
  unwrapOption,
} from "@metaplex-foundation/umi";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
import { setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
import {
  mplTokenMetadata,
  TokenStandard,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  mplCandyMachine,
  fetchCandyMachine,
  mintV2,
  safeFetchCandyGuard,
  DefaultGuardSetMintArgs,
  DefaultGuardSet,
  SolPayment,
  CandyMachine,
  CandyGuard,
} from "@metaplex-foundation/mpl-candy-machine";
import { AiOutlineTwitter } from "react-icons/ai";
import { IoStorefrontSharp } from "react-icons/io5";
import { SiDiscord } from "react-icons/si";

export default function Home() {
  const network = WalletAdapterNetwork.Mainnet;
  const endpoint = `${process.env.NEXT_PUBLIC_RPC_URL}`;

  const [isOpen, setIsOpen] = useState(false);

  const toggleMenu = () => {
    setIsOpen(!isOpen);
  };

  const wallets = useMemo(
    () => [new PhantomWalletAdapter({ network })],
    [network]
  );

  const WalletMultiButtonDynamic = dynamic(
    async () =>
      (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
    { ssr: false }
  );

  // set up umi
  let umi = createUmi(endpoint).use(mplTokenMetadata()).use(mplCandyMachine());

  // state
  const [loading, setLoading] = useState(false);
  const [mintCreated, setMintCreated] = useState(null);
  const [mintMsg, setMintMsg] = useState();
  const [costInSol, setCostInSol] = useState(0);
  const [cmv3v2, setCandyMachine] = useState();
  const [defaultCandyGuardSet, setDefaultCandyGuardSet] = useState();
  const [countTotal, setCountTotal] = useState();
  const [countRemaining, setCountRemaining] = useState();
  const [countMinted, setCountMinted] = useState();
  const [mintDisabled, setMintDisabled] = useState(true);

  // retrieve item counts to determine availability and
  // from the solPayment, display cost on the Mint button
  const retrieveAvailability = async () => {
    const cmId = process.env.NEXT_PUBLIC_CANDY_MACHINE_ID;
    if (!cmId) {
      setMintMsg("No candy machine ID found. Add environment variable.");
      return;
    }
    const candyMachine = await fetchCandyMachine(umi, publicKey(cmId));
    setCandyMachine(candyMachine);

    // Get counts
    setCountTotal(candyMachine.itemsLoaded);
    setCountMinted(Number(candyMachine.itemsRedeemed));
    const remaining =
      candyMachine.itemsLoaded - Number(candyMachine.itemsRedeemed);
    setCountRemaining(remaining);

    // Get cost
    const candyGuard = await safeFetchCandyGuard(
      umi,
      candyMachine.mintAuthority
    );
    if (candyGuard) {
      setDefaultCandyGuardSet(candyGuard);
    }
    const defaultGuards = candyGuard?.guards;
    const solPaymentGuard = defaultGuards?.solPayment;

    if (solPaymentGuard) {
      const solPayment = unwrapOption(solPaymentGuard);
      if (solPayment) {
        const lamports = solPayment.lamports;
        const solCost = Number(lamports.basisPoints) / 1000000000;
        setCostInSol(solCost);
      }
    }

    if (remaining > 0) {
      setMintDisabled(false);
    }
  };

  useEffect(() => {
    retrieveAvailability();
  }, [mintCreated]); // Empty dependency array means run only once on mount

  // Inner Mint component to handle showing the Mint button,
  // and mint messages
  const Mint = () => {
    const wallet = useWallet();
    umi = umi.use(walletAdapterIdentity(wallet));

    // check wallet balance
    const checkWalletBalance = async () => {
      const balance = await umi.rpc.getBalance(umi.identity.publicKey);
      if (Number(balance.basisPoints) / 1000000000 < costInSol) {
        setMintMsg("Add more SOL to your wallet.");
        setMintDisabled(true);
      } else {
        if (countRemaining !== undefined && countRemaining > 0) {
          setMintDisabled(false);
        }
      }
    };

    if (!wallet.connected) {
      return <p>Please connect your wallet.</p>;
    }

    checkWalletBalance();

    const mintBtnHandler = async () => {
      if (!cmv3v2 || !defaultCandyGuardSet) {
        setMintMsg(
          "There was an error fetching the candy machine. Try refreshing your browser window."
        );
        return;
      }
      setLoading(true);
      setMintMsg(undefined);

      try {
        const candyMachine = cmv3v2;
        const candyGuard = defaultCandyGuardSet;

        const nftSigner = generateSigner(umi);

        const mintArgs = {};

        // solPayment has mintArgs
        const defaultGuards = candyGuard?.guards;
        const solPaymentGuard = defaultGuards?.solPayment;
        if (solPaymentGuard) {
          const solPayment = unwrapOption(solPaymentGuard);
          if (solPayment) {
            const treasury = solPayment.destination;

            mintArgs.solPayment = some({
              destination: treasury,
            });
          }
        }

        const tx = transactionBuilder()
          .add(setComputeUnitLimit(umi, { units: 600_000 }))
          .add(
            mintV2(umi, {
              candyMachine: candyMachine.publicKey,
              collectionMint: candyMachine.collectionMint,
              collectionUpdateAuthority: candyMachine.authority,
              nftMint: nftSigner,
              candyGuard: candyGuard?.publicKey,
              mintArgs: mintArgs,
              tokenStandard: TokenStandard.ProgrammableNonFungible,
            })
          );

        const { signature } = await tx.sendAndConfirm(umi, {
          confirm: { commitment: "finalized" },
          send: {
            skipPreflight: true,
          },
        });

        setMintCreated(nftSigner.publicKey);
        setMintMsg("Mint was successful!");
      } catch (err) {
        console.error(err);
        setMintMsg(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (mintCreated) {
      return (
        <a
          target="_blank"
          rel="noreferrer"
          href={`https://solscan.io/token/${base58PublicKey(mintCreated)}${
            network === "mainnet-beta" ? "?cluster=mainnet-beta" : ""
          }`}
        >
          <Image
            src="/nftHolder.png"
            alt="Blank NFT"
            width={300}
            height={300}
            priority
          />
          <p className="mintAddress">
            <code>{base58PublicKey(mintCreated)}</code>
          </p>
        </a>
      );
    }

    return (
      <>
        <button onClick={mintBtnHandler} disabled={mintDisabled || loading}>
          MINT
          <br />({costInSol} SOL)
        </button>
        {loading && <div>. . .</div>}
      </>
    );
  }; // </Mint>

  return (
    <WalletProvider wallets={wallets} autoConnect>
      <WalletModalProvider>
        <main
          className="min-h-screen bg-black text-white"
          style={{ fontFamily: "MyUnderwood, sans-serif" }}
        >
          <nav
            className="bg-black text-white shadow-lg"
            style={{ fontFamily: "MyUnderwood, sans-serif" }}
          >
            <div className="max-w-6xl mx-auto px-4">
              <div className="flex justify-between">
                <div className="flex space-x-7">
                  <div>
                    <Link href="/" className="flex items-center py-4">
                      <span className="font-semibold text-lg">tA</span>
                    </Link>
                  </div>
                </div>
                {/* Hide key icon on small screens and show on medium screens and above */}
                <div className="text-center py-6 lg:py-4">
                  <WalletMultiButtonDynamic />
                </div>
                <div>
                  <Link
                    href="https://www.uploadanon.com/"
                    className="block text-lg py-4 hover:bg-green-500 transition duration-300"
                  >
                    &#127912;{" "}
                  </Link>
                </div>
              </div>
            </div>
          </nav>
          <div className="container mx-auto px-4">
            <div className="bg-black shadow rounded-lg p-8">
              <h1 className="text-2xl font-bold text-white text-center">
                mint a ticket
              </h1>
              <p className="mt-4 text-white text-center">join the community</p>
            </div>
            <div className="grid place-items-center">
              <div className="shadow-glow">
                <Image
                  src="/preview.png"
                  alt="Preview of NFTs"
                  width={300}
                  height={300}
                  priority
                />
              </div>

              <div className="text-center py-4">
                <div>
                  Minted: {countMinted} / {countTotal}
                </div>
                <div>Remaining: {countRemaining}</div>
              </div>
              <Mint />
              {mintMsg && (
                <div className="text-center">
                  <button
                    onClick={() => {
                      setMintMsg(undefined);
                    }}
                  >
                    &times;
                  </button>
                  <span>{mintMsg}</span>
                </div>
              )}
              <div className="text-center">
                <p className="text-md pt-12 pb-6">
                  there is more to all this...
                </p>
              </div>

              <div className="text-2xl lg:text-4xl flex justify-center gap-16 ">
                <a
                  href="https://twitter.com/ta_worId"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <AiOutlineTwitter />
                </a>
                <a
                  href="https://magiceden.io/marketplace/traders_anonymous_tickets"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <IoStorefrontSharp />
                </a>
                <a
                  href="https://discord.gg/egcH4Gnn"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <SiDiscord />
                </a>
              </div>
            </div>
          </div>
        </main>
      </WalletModalProvider>
    </WalletProvider>
  );
}
