import { PoolEstimate } from '@blend-capital/blend-sdk';
import { Box, Typography, useTheme } from '@mui/material';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { BackstopPreviewBar } from '../components/backstop/BackstopPreviewBar';
import { BorrowMarketList } from '../components/borrow/BorrowMarketList';
import { BorrowPositionList } from '../components/borrow/BorrowPositionList';
import { AllbridgeButton } from '../components/bridge/allbridge';
import { Divider } from '../components/common/Divider';
import { Row } from '../components/common/Row';
import { Section, SectionSize } from '../components/common/Section';
import { ToggleButton } from '../components/common/ToggleButton';
import { PositionOverview } from '../components/dashboard/PositionOverview';
import { LendMarketList } from '../components/lend/LendMarketList';
import { LendPositionList } from '../components/lend/LendPositionList';
import { NotPoolBar } from '../components/pool/NotPoolBar';
import { PoolExploreBar } from '../components/pool/PoolExploreBar';
import { PoolHealthBanner } from '../components/pool/PoolHealthBanner';
import { useSettings } from '../contexts';
import { usePool, usePoolMeta, usePoolOracle } from '../hooks/api';
import { NOT_BLEND_POOL_ERROR_MESSAGE } from '../hooks/types';
import { toBalance } from '../utils/formatter';
import { MAINNET_USDC_CONTRACT_ADDRESS } from '../utils/token_display';

const Dashboard: NextPage = () => {
  const router = useRouter();
  const theme = useTheme();
  const { showLend, setShowLend } = useSettings();

  const { poolId } = router.query;
  const safePoolId = typeof poolId == 'string' && /^[0-9A-Z]{56}$/.test(poolId) ? poolId : '';

  const { data: poolMeta, error: poolError } = usePoolMeta(safePoolId);
  const { data: pool } = usePool(poolMeta);
  const { data: poolOracle, isError: isOracleError } = usePoolOracle(pool);

  const marketSize =
    poolOracle !== undefined && pool !== undefined
      ? PoolEstimate.build(pool.reserves, poolOracle).totalSupply
      : 0;

  const handleLendClick = () => {
    if (!showLend) {
      setShowLend(true);
    }
  };

  const handleBorrowClick = () => {
    if (showLend) {
      setShowLend(false);
    }
  };

  if (poolError?.message === NOT_BLEND_POOL_ERROR_MESSAGE) {
    return <NotPoolBar poolId={safePoolId} />;
  }

  return (
    <>
      <PoolHealthBanner poolId={safePoolId} />
      <PoolExploreBar poolId={safePoolId} />
      {pool &&
        Array.from(pool.reserves.keys()).some(
          (assetId) => assetId === MAINNET_USDC_CONTRACT_ADDRESS
        ) && <AllbridgeButton />}
      <Divider />
      <BackstopPreviewBar poolId={safePoolId} />
      <Divider />
      <Row>
        <Box sx={{ paddingLeft: '6px' }}>
          <Typography variant="h2" sx={{ padding: '6px' }}>
            Your positions
          </Typography>
        </Box>
      </Row>
      <PositionOverview poolId={safePoolId} />
      <LendPositionList poolId={safePoolId} />
      <BorrowPositionList poolId={safePoolId} />
      <Divider />
      <Row>
        <Section width={SectionSize.FULL} sx={{ padding: '0px' }}>
          <ToggleButton
            active={showLend}
            palette={theme.palette.lend}
            sx={{ width: '50%', padding: '12px' }}
            onClick={handleLendClick}
          >
            Supply
          </ToggleButton>
          <ToggleButton
            active={!showLend}
            palette={theme.palette.borrow}
            sx={{ width: '50%', padding: '12px' }}
            onClick={handleBorrowClick}
          >
            Borrow
          </ToggleButton>
        </Section>
      </Row>
      <Row sx={{ padding: '6px', justifyContent: 'space-between' }}>
        <Typography variant="body1">{`Assets to ${showLend ? 'supply' : 'borrow'}`}</Typography>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            padding: '6px',
          }}
        >
          <Typography variant="body2" mr={1}>
            Market size:
          </Typography>
          <Typography variant="body1">{`$${toBalance(marketSize)}`}</Typography>
        </Box>
      </Row>
      <Divider />
      {showLend ? <LendMarketList poolId={safePoolId} /> : <BorrowMarketList poolId={safePoolId} />}
    </>
  );
};

export default Dashboard;
