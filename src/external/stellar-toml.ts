import { TokenMetadata } from '@blend-capital/blend-sdk';
import { Horizon, StellarToml } from '@stellar/stellar-sdk';

export type TomlMetadata = {
  domain?: string;
  image?: string;
};

/**
 * based on an implementation from the freighter api https://github.com/stellar/freighter/blob/8cc2db65c2fcb0a1ce515431bc1c9212a06f682a/%40shared/api/helpers/getIconUrlFromIssuer.ts
 */
export async function getTokenMetadataFromTOML(
  horizonServer: Horizon.Server,
  tokenMetadata: TokenMetadata
): Promise<TomlMetadata> {
  let stellarToml: any;
  if (!tokenMetadata.asset) {
    // set soroban token defaults
    return { image: `/icons/tokens/soroban.svg` };
  }

  if (tokenMetadata.asset.isNative()) {
    // set native asset defaults
    return {
      domain: 'stellar.org',
      image: `/icons/tokens/xlm.svg`,
    };
  } else {
    const assetCode = tokenMetadata.asset.code;
    const assetIssuer = tokenMetadata.asset.issuer;
    const assetId = `${assetCode}:${assetIssuer}`;
    try {
      const cachedData = localStorage.getItem(assetId);
      if (cachedData) {
        const data = JSON.parse(cachedData);
        return data;
      }
      /* Otherwise, 1. load their account from the API */
      const tokenAccount = await horizonServer.loadAccount(assetIssuer);
      const tokenAccountHomeDomain = tokenAccount.home_domain;
      if (!tokenAccountHomeDomain) {
        // If the account doesn't have a home domain, we can't load the stellar.toml file return default stellar asset token metadata values (will always happen on testnet )
        return {
          domain: undefined,
          image: undefined,
        };
      }
      if (tokenAccountHomeDomain === 'stellar.org') {
        // If the account is stellar.org, we can return the default stellar asset token metadata values
        return {
          domain: undefined,
          image: undefined,
        };
      }
      // if (tokenAccountHomeDomain === 'circle.com') {
      //   stellarToml = await fetch('https://www.circle.com/hubfs/stellar.toml.txt')
      //     .then((response) => response.text())
      //     .then(async (text) => {
      //       try {
      //         const tomlObject = toml.parse(text);
      //         return Promise.resolve(tomlObject);
      //       } catch (e: any) {
      //         return Promise.reject(
      //           new Error(
      //             `stellar.toml is invalid - Parsing error on line ${e.line}, column ${e.column}: ${e.message}`
      //           )
      //         );
      //       }
      //     })
      //     .catch((err: Error) => {
      //       if (err.message.match(/^maxContentLength size/)) {
      //         throw new Error(`stellar.toml file exceeds allowed size`);
      //       } else {
      //         throw err;
      //       }
      //     });
      // } else {
      //   /* 2. Use their domain from their API account and use it attempt to load their stellar.toml */
      //   stellarToml = await StellarToml.Resolver.resolve(tokenAccountHomeDomain || '', {});
      // }
      stellarToml = await StellarToml.Resolver.resolve(tokenAccountHomeDomain || '', {});
      if (stellarToml.CURRENCIES) {
        /* If we find some currencies listed, check to see if they have the currency we're looking for listed */
        for (const { code: currencyCode, issuer, image } of stellarToml.CURRENCIES) {
          // Check if all necessary fields are available
          if (
            currencyCode &&
            issuer &&
            image &&
            assetCode === currencyCode &&
            assetIssuer === issuer
          ) {
            // Store a JSON representation of the currency details in local storage
            const tomlMetadata = {
              domain: tokenAccountHomeDomain || '',
              image,
            };
            localStorage.setItem(assetId, JSON.stringify(tomlMetadata));
            return tomlMetadata;
          }
        }
      }

      // no matching entry found
      console.log(
        `Unable to find currerncy entry for ${assetId} in toml for ${tokenAccountHomeDomain}`
      );
      return { image: undefined, domain: undefined };
    } catch (e) {
      console.error(e);
      // return stellar asset defaults if we can't find the icon
      return { image: undefined, domain: undefined };
    }
  }
}
