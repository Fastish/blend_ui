import {
  BackstopClaimArgs,
  BackstopContract,
  ContractErrorType,
  PoolBackstopActionArgs,
  PoolClaimArgs,
  PoolContract,
  Positions,
  SubmitArgs,
  parseError,
} from '@blend-capital/blend-sdk';
import {
  FreighterModule,
  ISupportedWallet,
  StellarWalletsKit,
  WalletNetwork,
  XBULL_ID,
  xBullModule,
} from '@creit.tech/stellar-wallets-kit/build/main';
import React, { useContext, useEffect, useState } from 'react';
import { BASE_FEE, Operation, SorobanRpc, Transaction, TransactionBuilder, xdr } from 'stellar-sdk';
import { useLocalStorageState } from '../hooks';
import { BACKSTOP_ID } from '../store/blendSlice';
import { useStore } from '../store/store';
import {
  CometClient,
  cometPoolDepositArgs,
  cometPoolGetDepositAmountByLPArgs,
} from '../utils/comet';
import { useSettings } from './settings';

export interface IWalletContext {
  connected: boolean;
  walletAddress: string;
  txStatus: TxStatus;
  lastTxHash: string | undefined;
  lastTxFailure: string | undefined;
  txType: TxType;
  connect: () => Promise<void>;
  disconnect: () => void;
  clearLastTx: () => void;
  restore: (sim: SorobanRpc.Api.SimulateTransactionRestoreResponse) => Promise<void>;
  poolSubmit: (
    poolId: string,
    submitArgs: SubmitArgs,
    sim: boolean
  ) => Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined>;
  poolClaim: (
    poolId: string,
    claimArgs: PoolClaimArgs,
    sim: boolean
  ) => Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined>;
  backstopDeposit(
    args: PoolBackstopActionArgs,
    sim: boolean
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined>;
  backstopWithdraw(
    args: PoolBackstopActionArgs,
    sim: boolean
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined>;
  backstopQueueWithdrawal(
    args: PoolBackstopActionArgs,
    sim: boolean
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined>;
  backstopDequeueWithdrawal(
    args: PoolBackstopActionArgs,
    sim: boolean
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined>;
  backstopClaim(
    args: BackstopClaimArgs,
    sim: boolean
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined>;
  backstopMintByDepositTokenAmount(
    args: cometPoolDepositArgs,
    sim: boolean,
    lpTokenAddress: string
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined>;
  backstopMintByLPTokenAmount(
    args: cometPoolGetDepositAmountByLPArgs,
    sim: boolean,
    lpTokenAddress: string
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined>;
  faucet(): Promise<undefined>;
}

export enum TxStatus {
  NONE,
  BUILDING,
  SIGNING,
  SUBMITTING,
  SUCCESS,
  RESTORED,
  FAIL,
}

export enum TxType {
  CONTRACT,
  RESTORE,
}

const WalletContext = React.createContext<IWalletContext | undefined>(undefined);

export const WalletProvider = ({ children = null as any }) => {
  const { lastPool } = useSettings();

  const network = useStore((state) => state.network);
  const rpc = useStore((state) => state.rpcServer());
  const loadBlendData = useStore((state) => state.loadBlendData);
  const loadUserData = useStore((state) => state.loadUserData);
  const clearUserData = useStore((state) => state.clearUserData);

  const [connected, setConnected] = useState<boolean>(false);
  const [autoConnect, setAutoConnect] = useLocalStorageState('autoConnectWallet', 'false');

  const [txStatus, setTxStatus] = useState<TxStatus>(TxStatus.NONE);
  const [txHash, setTxHash] = useState<string | undefined>(undefined);
  const [txFailure, setTxFailure] = useState<string | undefined>(undefined);
  const [txType, setTxType] = useState<TxType>(TxType.CONTRACT);
  // wallet state
  const [walletAddress, setWalletAddress] = useState<string>('');

  const walletKit: StellarWalletsKit = new StellarWalletsKit({
    network: network.passphrase as WalletNetwork,
    selectedWalletId: autoConnect !== undefined && autoConnect !== 'false' ? autoConnect : XBULL_ID,
    modules: [new xBullModule(), new FreighterModule()],
  });

  useEffect(() => {
    if (!connected && autoConnect !== 'false') {
      // @dev: timeout ensures chrome has the ability to load extensions
      setTimeout(() => {
        handleSetWalletAddress();
      }, 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect]);

  function setFailureMessage(message: string | undefined) {
    if (message) {
      // some contract failures include diagnostic information. If so, try and remove it.
      let substrings = message.split('Event log (newest first):');
      if (substrings.length > 1) {
        setTxFailure(substrings[0].trimEnd());
      }
    }
  }

  /**
   * Connect a wallet to the application via the walletKit
   */
  async function handleSetWalletAddress() {
    try {
      const publicKey = await walletKit.getPublicKey();
      setWalletAddress(publicKey);
      setConnected(true);
      await loadUserData(publicKey);
    } catch (e: any) {
      console.error('Unable to load wallet information: ', e);
    }
  }

  /**
   * Open up a modal to connect the user's browser wallet
   */
  async function connect() {
    try {
      await walletKit.openModal({
        onWalletSelected: async (option: ISupportedWallet) => {
          walletKit.setWallet(option.id);
          setAutoConnect(option.id);
          await handleSetWalletAddress();
        },
      });
    } catch (e: any) {
      console.error('Unable to connect wallet: ', e);
    }
  }

  function disconnect() {
    clearUserData();
    setWalletAddress('');
    setConnected(false);
    setAutoConnect('false');
  }

  /**
   * Sign an XDR string with the connected user's wallet
   * @param xdr - The XDR to sign
   * @param networkPassphrase - The network passphrase
   * @returns - The signed XDR as a base64 string
   */
  async function sign(xdr: string): Promise<string> {
    if (connected) {
      setTxStatus(TxStatus.SIGNING);
      try {
        let { result } = await walletKit.signTx({
          xdr: xdr,
          publicKeys: [walletAddress],
          network: network.passphrase as WalletNetwork,
        });
        setTxStatus(TxStatus.SUBMITTING);
        return result;
      } catch (e: any) {
        if (e === 'User declined access') {
          setTxFailure('Transaction rejected by wallet.');
        } else if (typeof e === 'string') {
          setTxFailure(e);
        }

        setTxStatus(TxStatus.FAIL);
        throw e;
      }
    } else {
      throw new Error('Not connected to a wallet');
    }
  }

  async function restore(sim: SorobanRpc.Api.SimulateTransactionRestoreResponse): Promise<void> {
    let account = await rpc.getAccount(walletAddress);
    setTxStatus(TxStatus.BUILDING);
    let fee = parseInt(sim.restorePreamble.minResourceFee) + parseInt(BASE_FEE);
    let restore_tx = new TransactionBuilder(account, { fee: fee.toString() })
      .setNetworkPassphrase(network.passphrase)
      .setTimeout(0)
      .setSorobanData(sim.restorePreamble.transactionData.build())
      .addOperation(Operation.restoreFootprint({}))
      .build();
    let signed_restore_tx = new Transaction(await sign(restore_tx.toXDR()), network.passphrase);
    setTxType(TxType.RESTORE);
    await sendTransaction(signed_restore_tx);
  }

  async function sendTransaction(transaction: Transaction) {
    let send_tx_response = await rpc.sendTransaction(transaction);
    let curr_time = Date.now();

    // Attempt to send the transaction and poll for the result
    while (send_tx_response.status !== 'PENDING' && Date.now() - curr_time < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      send_tx_response = await rpc.sendTransaction(transaction);
    }
    if (send_tx_response.status !== 'PENDING') {
      let error = parseError(send_tx_response);
      setFailureMessage(ContractErrorType[error.type]);
      setTxStatus(TxStatus.FAIL);
    }

    let get_tx_response = await rpc.getTransaction(send_tx_response.hash);
    while (get_tx_response.status === 'NOT_FOUND') {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      get_tx_response = await rpc.getTransaction(send_tx_response.hash);
    }

    let hash = transaction.hash().toString('hex');
    setTxHash(hash);
    if (get_tx_response.status === 'SUCCESS') {
      console.log('Successfully submitted transaction: ', hash);
      setTxStatus(TxStatus.SUCCESS);
    } else {
      console.log('Failed Transaction Hash: ', hash);
      let error = parseError(get_tx_response);
      setFailureMessage(ContractErrorType[error.type]);
      setTxStatus(TxStatus.FAIL);
    }
  }

  async function simulateOperation(
    operation: xdr.Operation
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
    let account = await rpc.getAccount(walletAddress);
    let tx_builder = new TransactionBuilder(account, {
      networkPassphrase: network.passphrase,
      fee: BASE_FEE,
      timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 5 * 60 * 1000 },
    }).addOperation(operation);
    let transaction = tx_builder.build();
    let simulation = await rpc.simulateTransaction(transaction);
    return simulation;
  }

  async function invokeSorobanOperation<T>(operation: xdr.Operation, poolId?: string | undefined) {
    try {
      let account = await rpc.getAccount(walletAddress);
      let tx_builder = new TransactionBuilder(account, {
        networkPassphrase: network.passphrase,
        fee: BASE_FEE,
        timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 5 * 60 * 1000 },
      }).addOperation(operation);
      let transaction = tx_builder.build();
      let simResponse = await simulateOperation(operation);
      let assembled_tx = SorobanRpc.assembleTransaction(transaction, simResponse).build();
      let signedTx = await sign(assembled_tx.toXDR());
      let tx = new Transaction(signedTx, network.passphrase);
      await sendTransaction(tx);
      if (txStatus == TxStatus.SUCCESS && poolId !== undefined) {
        try {
          await loadBlendData(true, poolId, walletAddress);
        } catch {
          console.error('Failed reloading blend data for account: ', walletAddress);
        }
      }
    } catch (e: any) {
      console.error('Failed submitting transaction: ', e);
      setFailureMessage(e?.message);
      setTxStatus(TxStatus.FAIL);
    }
  }

  function clearLastTx() {
    setTxStatus(TxStatus.NONE);
    setTxHash(undefined);
    setTxFailure(undefined);
    setTxType(TxType.CONTRACT);
  }

  //********** Pool Functions ***********/

  /**
   * Submit a request to the pool
   * @param poolId - The contract address of the pool
   * @param submitArgs - The "submit" function args
   * @param sim - "true" if simulating the transaction, "false" if submitting
   * @returns The Positions, or undefined
   */
  async function poolSubmit(
    poolId: string,
    submitArgs: SubmitArgs,
    sim: boolean
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined> {
    if (connected) {
      let pool = new PoolContract(poolId);
      let operation = xdr.Operation.fromXDR(pool.submit(submitArgs), 'base64');
      if (sim) {
        return await simulateOperation(operation);
      }
      await invokeSorobanOperation<Positions>(operation, poolId);
    }
  }

  /**
   * Claim emissions from the pool
   * @param poolId - The contract address of the pool
   * @param claimArgs - The "claim" function args
   * @param sim - "true" if simulating the transaction, "false" if submitting
   * @returns The Positions, or undefined
   */
  async function poolClaim(
    poolId: string,
    claimArgs: PoolClaimArgs,
    sim: boolean
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined> {
    if (connected) {
      let pool = new PoolContract(poolId);
      let operation = xdr.Operation.fromXDR(pool.claim(claimArgs), 'base64');
      if (sim) {
        return await simulateOperation(operation);
      }
      await invokeSorobanOperation(operation, poolId);
    }
  }

  //********** Backstop Functions ***********/

  /**
   * Execute an deposit against the backstop
   * @param args - The args of the deposit
   * @param sim - "true" if simulating the transaction, "false" if submitting
   * @returns The Positions, or undefined
   */
  async function backstopDeposit(
    args: PoolBackstopActionArgs,
    sim: boolean
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined> {
    if (connected) {
      let backstop = new BackstopContract(BACKSTOP_ID);
      let operation = xdr.Operation.fromXDR(backstop.deposit(args), 'base64');
      if (sim) {
        return await simulateOperation(operation);
      }
      await invokeSorobanOperation(operation);
    }
  }

  /**
   * Execute an withdraw against the backstop
   * @param args - The args of the withdraw
   * @param sim - "true" if simulating the transaction, "false" if submitting
   * @returns The Positions, or undefined
   */
  async function backstopWithdraw(
    args: PoolBackstopActionArgs,
    sim: boolean
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined> {
    if (connected) {
      let backstop = new BackstopContract(BACKSTOP_ID);
      let operation = xdr.Operation.fromXDR(backstop.withdraw(args), 'base64');
      if (sim) {
        return await simulateOperation(operation);
      }
      await invokeSorobanOperation(operation);
    }
  }

  /**
   * Execute an queue withdrawal against the backstop
   * @param args - The args of the queue withdrawal
   * @param sim - "true" if simulating the transaction, "false" if submitting
   * @returns The Positions, or undefined
   */
  async function backstopQueueWithdrawal(
    args: PoolBackstopActionArgs,
    sim: boolean
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined> {
    if (connected) {
      let backstop = new BackstopContract(BACKSTOP_ID);
      let operation = xdr.Operation.fromXDR(backstop.queueWithdrawal(args), 'base64');
      if (sim) {
        return await simulateOperation(operation);
      }
      await invokeSorobanOperation(operation);
    }
  }

  /**
   * Execute an dequeue withdrawal against the backstop
   * @param args - The args of the queue withdrawal
   * @param sim - "true" if simulating the transaction, "false" if submitting
   * @returns The Positions, or undefined
   */
  async function backstopDequeueWithdrawal(
    args: PoolBackstopActionArgs,
    sim: boolean
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined> {
    if (connected) {
      let backstop = new BackstopContract(BACKSTOP_ID);
      let operation = xdr.Operation.fromXDR(backstop.dequeueWithdrawal(args), 'base64');
      if (sim) {
        return await simulateOperation(operation);
      }
      await invokeSorobanOperation(operation);
    }
  }

  /**
   * Claim emissions from the backstop
   * @param claimArgs - The "claim" function args
   * @param sim - "true" if simulating the transaction, "false" if submitting
   * @returns The claimed amount
   */
  async function backstopClaim(
    claimArgs: BackstopClaimArgs,
    sim: boolean
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined> {
    if (connected) {
      let backstop = new BackstopContract(BACKSTOP_ID);
      let operation = xdr.Operation.fromXDR(backstop.claim(claimArgs), 'base64');
      if (sim) {
        return await simulateOperation(operation);
      }
      await invokeSorobanOperation(operation);
    }
  }
  /**
   * Execute a mint for the Backstop LP token using deposit token amount
   * @param args - The args of the deposit
   * @param sim - "true" if simulating the transaction, "false" if submitting
   * @returns The Positions, or undefined
   */
  async function backstopMintByDepositTokenAmount(
    { depositTokenAddress, depositTokenAmount, minLPTokenAmount }: cometPoolDepositArgs,
    sim: boolean,
    lpTokenAddress: string
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined> {
    try {
      if (connected) {
        let cometClient = new CometClient(lpTokenAddress);
        let operation = cometClient.depositTokenInGetLPOut(
          depositTokenAddress,
          depositTokenAmount,
          minLPTokenAmount,
          walletAddress
        );
        if (sim) {
          return await simulateOperation(operation);
        }
        await invokeSorobanOperation(operation);
      }
    } catch (e) {
      throw e;
    }
  }
  /**
   * Execute a mint for the Backstop LP token using LP token amount
   * @param args - The args of the deposit
   * @param sim - "true" if simulating the transaction, "false" if submitting
   * @returns The Positions, or undefined
   */
  async function backstopMintByLPTokenAmount(
    {
      depositTokenAddress,
      LPTokenAmount,
      maxDepositTokenAmount,
    }: cometPoolGetDepositAmountByLPArgs,
    sim: boolean,
    lpTokenAddress: string
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse | undefined> {
    if (connected) {
      let cometClient = new CometClient(lpTokenAddress);
      let operation = cometClient.depositTokenInGetLPOut(
        depositTokenAddress,
        LPTokenAmount,
        maxDepositTokenAmount,
        walletAddress
      );
      if (sim) {
        return await simulateOperation(operation);
      }
      await invokeSorobanOperation(operation);
    }
  }

  async function faucet(): Promise<undefined> {
    if (connected) {
      const url = `https://ewqw4hx7oa.execute-api.us-east-1.amazonaws.com/getAssets?userId=${walletAddress}`;
      try {
        setTxStatus(TxStatus.BUILDING);
        const resp = await fetch(url, { method: 'GET' });
        const txEnvelopeXDR = await resp.text();
        let transaction = new Transaction(
          xdr.TransactionEnvelope.fromXDR(txEnvelopeXDR, 'base64'),
          network.passphrase
        );

        let signedTx = new Transaction(await sign(transaction.toXDR()), network.passphrase);
        await sendTransaction(signedTx);
        try {
          // reload Horizon account after submission
          try {
            await loadUserData(walletAddress);
          } catch {
            console.error('Failed loading account: ', walletAddress);
          }

          return;
        } catch (e: any) {
          console.error('Failed submitting transaction: ', e);
          setFailureMessage(e?.message);
          setTxStatus(TxStatus.FAIL);
          return undefined;
        }
      } catch (e) {}
    }
  }

  return (
    <WalletContext.Provider
      value={{
        connected,
        walletAddress,
        txStatus,
        lastTxHash: txHash,
        lastTxFailure: txFailure,
        txType,
        connect,
        disconnect,
        clearLastTx,
        restore,
        poolSubmit,
        poolClaim,
        backstopDeposit,
        backstopWithdraw,
        backstopQueueWithdrawal,
        backstopDequeueWithdrawal,
        backstopClaim,
        backstopMintByDepositTokenAmount,
        backstopMintByLPTokenAmount,
        faucet,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);

  if (!context) {
    throw new Error('Component rendered outside the provider tree');
  }

  return context;
};
