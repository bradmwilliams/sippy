import './ComponentReadiness.css'
import {
  ArrayParam,
  BooleanParam,
  NumberParam,
  SafeStringParam,
  StringParam,
  useQueryParam,
} from 'use-query-params'
import {
  cancelledDataTable,
  formatLongDate,
  getAPIUrl,
  getColumns,
  getUpdatedUrlParts,
  gotFetchError,
  initialPageTable,
  makePageTitle,
  makeRFC3339Time,
  noDataTable,
} from './CompReadyUtils'
import {
  Drawer,
  Grid,
  TableContainer,
  Tooltip,
  Typography,
} from '@material-ui/core'
import { Fragment, useEffect, useState } from 'react'
import {
  Link,
  Route,
  Switch,
  useLocation,
  useRouteMatch,
} from 'react-router-dom'

import { makeStyles, useTheme } from '@material-ui/core/styles'
import ChevronLeftIcon from '@material-ui/icons/ChevronLeft'
import ChevronRightIcon from '@material-ui/icons/ChevronRight'
import clsx from 'clsx'
import CompReadyCapabilities from './CompReadyCapabilities'
import CompReadyCapability from './CompReadyCapability'
import CompReadyCapabilityTest from './CompReadyCapabilityTest'
import CompReadyEnvCapabilities from './CompReadyEnvCapabilities'
import CompReadyEnvCapability from './CompReadyEnvCapability'
import CompReadyEnvCapabilityTest from './CompReadyEnvCapabilityTest'
import CompReadyMainInputs from './CompReadyMainInputs'
import CompReadyProgress from './CompReadyProgress'
import CompReadyRow from './CompReadyRow'
import IconButton from '@material-ui/core/IconButton'
import MenuIcon from '@material-ui/icons/Menu'
import React from 'react'
import Table from '@material-ui/core/Table'
import TableBody from '@material-ui/core/TableBody'
import TableCell from '@material-ui/core/TableCell'
import TableHead from '@material-ui/core/TableHead'
import TableRow from '@material-ui/core/TableRow'

const drawerWidth = 240

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    flexGrow: 1,
  },
  title: {
    flexGrow: 1,
  },
  appBar: {
    transition: theme.transitions.create(['margin', 'width'], {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.leavingScreen,
    }),
  },
  appBarShift: {
    width: `calc(100% - ${drawerWidth}px)`,
    marginLeft: drawerWidth,
    transition: theme.transitions.create(['margin', 'width'], {
      easing: theme.transitions.easing.easeOut,
      duration: theme.transitions.duration.enteringScreen,
    }),
  },
  backdrop: {
    zIndex: theme.zIndex.drawer + 1,
    color: '#fff',
  },
  menuButton: {
    marginRight: theme.spacing(2),
  },
  hide: {
    display: 'none',
  },
  drawer: {
    width: drawerWidth,
    flexShrink: 0,
  },
  drawerPaper: {
    width: drawerWidth,
  },
  drawerHeader: {
    display: 'flex',
    alignItems: 'center',
    padding: theme.spacing(0, 1),
    // necessary for content to be below app bar
    ...theme.mixins.toolbar,
    justifyContent: 'flex-end',
  },
  content: {
    maxWidth: '100%',
    flexGrow: 1,
    padding: theme.spacing(3),
    transition: theme.transitions.create('margin', {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.leavingScreen,
    }),
    marginLeft: -drawerWidth,
  },
  contentShift: {
    transition: theme.transitions.create('margin', {
      easing: theme.transitions.easing.easeOut,
      duration: theme.transitions.duration.enteringScreen,
    }),
    marginLeft: 0,
  },
}))

const days = 24 * 60 * 60 * 1000
const initialTime = new Date()
const initialStartTime = new Date(initialTime.getTime() - 30 * days)
const initialEndTime = new Date(initialTime.getTime())
const initialPrevStartTime = new Date(initialTime.getTime() - 30 * days)
const initialPrevEndTime = new Date(initialTime.getTime())

// Big query requests take a while so give the user the option to
// abort in case they inadvertently requested a huge dataset.
let abortController = new AbortController()
const cancelFetch = () => {
  abortController.abort()
}

export default function ComponentReadiness(props) {
  console.log('ComponentReadiness start')
  const classes = useStyles()
  const theme = useTheme()

  const [drawerOpen, setDrawerOpen] = React.useState(true)
  const handleDrawerOpen = () => {
    setDrawerOpen(true)
  }

  const handleDrawerClose = () => {
    setDrawerOpen(false)
  }

  // Create the variables for the URL and set any initial values.
  const [baseReleaseParam = '4.13', setBaseReleaseParam] = useQueryParam(
    'baseRelease',
    StringParam
  )
  const [
    baseStartTimeParam = formatLongDate(initialStartTime),
    setBaseStartTimeParam,
  ] = useQueryParam('baseStartTime', StringParam)
  const [
    baseEndTimeParam = formatLongDate(initialEndTime),
    setBaseEndTimeParam,
  ] = useQueryParam('baseEndTime', StringParam)
  const [sampleReleaseParam = '4.14', setSampleReleaseParam] = useQueryParam(
    'sampleRelease',
    StringParam
  )
  const [
    sampleStartTimeParam = formatLongDate(initialPrevStartTime),
    setSampleStartTimeParam,
  ] = useQueryParam('sampleStartTime', StringParam)
  const [
    sampleEndTimeParam = formatLongDate(initialPrevEndTime),
    setSampleEndTimeParam,
  ] = useQueryParam('sampleEndTime', StringParam)
  const [
    groupByCheckedItemsParam = ['cloud', 'arch', 'network'],
    setGroupByCheckedItemsParam,
  ] = useQueryParam('group_by', ArrayParam)
  const [
    excludeCloudsCheckedItemsParam = [],
    setExcludeCloudsCheckedItemsParam,
  ] = useQueryParam('exclude_clouds', ArrayParam)
  const [
    excludeArchesCheckedItemsParam = [],
    setExcludeArchesCheckedItemsParam,
  ] = useQueryParam('exclude_arches', ArrayParam)
  const [
    excludeNetworksCheckedItemsParam = [],
    setExcludeNetworksCheckedItemsParam,
  ] = useQueryParam('exclude_networks', ArrayParam)
  const [
    excludeUpgradesCheckedItemsParam = [],
    setExcludeUpgradesCheckedItemsParam,
  ] = useQueryParam('exclude_upgrades', ArrayParam)
  const [
    excludeVariantsCheckedItemsParam = [],
    setExcludeVariantsCheckedItemsParam,
  ] = useQueryParam('exclude_variants', ArrayParam)

  const [confidenceParam = 95, setConfidenceParam] = useQueryParam(
    'confidence',
    NumberParam
  )
  const [pityParam = 0, setPityParam] = useQueryParam('pity', NumberParam)
  const [minFailParam = 3, setMinFailParam] = useQueryParam(
    'minFail',
    NumberParam
  )
  const [ignoreMissingParam = false, setIgnoreMissingParam] = useQueryParam(
    'ignoreMissing',
    BooleanParam
  )
  const [ignoreDisruptionParam = false, setIgnoreDisruptionParam] =
    useQueryParam('ignoreDisruption', BooleanParam)

  const [componentParam, setComponentParam] = useQueryParam(
    'component',
    SafeStringParam
  )
  const [environmentParam, setEnvironmentParam] = useQueryParam(
    'environment',
    StringParam
  )
  const [capabilityParam, setCapabilityParam] = useQueryParam(
    'capability',
    StringParam
  )
  const [testIdParam, setTestIdParam] = useQueryParam('test_id', StringParam)

  // Create the variables to be used for api calls; these are initilized to the
  // value of the variables that got their values from the URL.
  const [groupByCheckedItems, setGroupByCheckedItems] = React.useState(
    groupByCheckedItemsParam
  )
  const [component, setComponent] = React.useState(componentParam)
  const [environment, setEnvironment] = React.useState(environmentParam)
  const [capability, setCapability] = React.useState(capabilityParam)
  const [testId, setTestId] = React.useState(testIdParam)

  const [excludeCloudsCheckedItems, setExcludeCloudsCheckedItems] =
    React.useState(excludeCloudsCheckedItemsParam)
  const [excludeArchesCheckedItems, setExcludeArchesCheckedItems] =
    React.useState(excludeArchesCheckedItemsParam)
  const [excludeNetworksCheckedItems, setExcludeNetworksCheckedItems] =
    React.useState(excludeNetworksCheckedItemsParam)

  const [baseRelease, setBaseRelease] = React.useState(baseReleaseParam)

  const [sampleRelease, setSampleRelease] = React.useState(sampleReleaseParam)

  const [baseStartTime, setBaseStartTime] = React.useState(baseStartTimeParam)

  const [baseEndTime, setBaseEndTime] = React.useState(baseEndTimeParam)

  const [sampleStartTime, setSampleStartTime] =
    React.useState(sampleStartTimeParam)
  const [sampleEndTime, setSampleEndTime] = React.useState(sampleEndTimeParam)
  const [excludeUpgradesCheckedItems, setExcludeUpgradesCheckedItems] =
    React.useState(excludeUpgradesCheckedItemsParam)
  const [excludeVariantsCheckedItems, setExcludeVariantsCheckedItems] =
    React.useState(excludeVariantsCheckedItemsParam)

  const [confidence, setConfidence] = React.useState(confidenceParam)
  const [pity, setPity] = React.useState(pityParam)
  const [minFail, setMinFail] = React.useState(minFailParam)

  // for the two boolean values here, we need the || false because otherwise
  // the value will be null.
  const [ignoreMissing, setIgnoreMissing] = React.useState(
    ignoreMissingParam || false
  )
  const [ignoreDisruption, setIgnoreDisruption] = React.useState(
    ignoreDisruptionParam || false
  )

  const { path, url } = useRouteMatch()

  const [fetchError, setFetchError] = React.useState('')
  const [isLoaded, setIsLoaded] = React.useState(false)
  const [data, setData] = React.useState({})

  useEffect(() => {
    setData(initialPageTable)
    setIsLoaded(true)
  }, [])

  document.title = `Sippy > Component Readiness`
  if (fetchError !== '') {
    return gotFetchError(fetchError)
  }

  // Show the current state of the filter variables and the url.
  // Create API call string and return it.
  const showValuesForReport = () => {
    console.log('--------------- showValuesForReport ------------------')
    console.log('baseRelease', baseRelease)
    console.log('baseStartTime', baseStartTime)
    console.log('baseEndTime', baseEndTime)
    console.log('sampleRelease', sampleRelease)
    console.log('sampleStartTime', sampleStartTime)
    console.log('sampleEndTime', sampleEndTime)
    console.log('groupBy: ', groupByCheckedItems)
    console.log('excludeClouds: ', excludeCloudsCheckedItems)
    console.log('excludeArches', excludeArchesCheckedItems)
    console.log('excludeNetworks', excludeNetworksCheckedItems)
    console.log('excludeUpgrades', excludeUpgradesCheckedItems)
    console.log('excludeVariants', excludeVariantsCheckedItems)
    console.log('confidence:', confidence)
    console.log('pity:', pity)
    console.log('minFail:', minFail)
    console.log('ignoreDisruption:', ignoreDisruption)
    console.log('ignoreMissing:', ignoreMissing)
    console.log('component', component)
    console.log('environment', environment)
    console.log('testId', testId)

    // process.env.REACT_APP_API_URL +
    const apiCallStr =
      getAPIUrl() +
      getUpdatedUrlParts(
        baseRelease,
        baseStartTime,
        baseEndTime,
        sampleRelease,
        sampleStartTime,
        sampleEndTime,
        groupByCheckedItems,
        excludeCloudsCheckedItems,
        excludeArchesCheckedItems,
        excludeNetworksCheckedItems,
        excludeUpgradesCheckedItems,
        excludeVariantsCheckedItems,
        confidence,
        pity,
        minFail,
        ignoreDisruption,
        ignoreMissing
      )
    const formattedApiCallStr = makeRFC3339Time(apiCallStr)
    console.log('formatted api call: ')
    formattedApiCallStr
      .split('?')[1]
      .split('&')
      .map((item) => {
        console.log('   ', item)
      })
    console.log('apiurl: ', formattedApiCallStr)
    return formattedApiCallStr
  }

  if (!isLoaded) {
    return (
      <CompReadyProgress
        apiLink={showValuesForReport()}
        cancelFunc={cancelFetch}
      />
    )
  }

  const handleClick = () => {
    window.location.href = '/component_readiness'
  }
  const columnNames = getColumns(data)
  if (columnNames[0] === 'Cancelled' || columnNames[0] == 'None') {
    return (
      <Fragment>
        <p>Operation cancelled or no data</p>
        <button onClick={handleClick}>Start Over</button>
      </Fragment>
    )
  }

  if (Object.keys(data).length === 0 || data.rows.length === 0) {
    return <p>No data.</p>
  }

  if (data.tests && Object.keys(data.tests).length === 0) {
    return (
      <Fragment>
        {pageTitle}
        <p>No Results.</p>
      </Fragment>
    )
  }

  if (data.length === 0) {
    return (
      <Typography variant="h6" style={{ marginTop: 50 }}>
        No per-variant data found.
      </Typography>
    )
  }

  let fromFile = false

  const handleGenerateReportDebug = (event) => {
    fromFile = true
    setBaseRelease('4.13')
    setBaseStartTime(formatLongDate('2023-03-01 00:00:00'))
    setBaseEndTime(formatLongDate('2023-03-31 00:00:00'))
    setSampleRelease('4.14')
    setSampleStartTime(formatLongDate('2023-03-01 00:00:00'))
    setSampleEndTime(formatLongDate('2023-03-31 00:00:00'))
    setGroupByCheckedItems(['cloud', 'arch', 'network'])
    setExcludeCloudsCheckedItems([])
    setExcludeArchesCheckedItems([])
    setExcludeNetworksCheckedItems([])
    setExcludeUpgradesCheckedItems([])
    setExcludeVariantsCheckedItems([])
    setComponent('')
    handleGenerateReport(event)
  }

  // This runs when someone pushes the "Generate Report" button.
  // We form an api string and then call the api.
  const handleGenerateReport = (event) => {
    event.preventDefault()
    setBaseReleaseParam(baseRelease)
    setBaseStartTimeParam(formatLongDate(baseStartTime))
    setBaseEndTimeParam(formatLongDate(baseEndTime))
    setSampleReleaseParam(sampleRelease)
    setSampleStartTimeParam(formatLongDate(sampleStartTime))
    setSampleEndTimeParam(formatLongDate(sampleEndTime))
    setGroupByCheckedItemsParam(groupByCheckedItems)
    setExcludeCloudsCheckedItemsParam(excludeCloudsCheckedItems)
    setExcludeArchesCheckedItemsParam(excludeArchesCheckedItems)
    setExcludeNetworksCheckedItemsParam(excludeNetworksCheckedItems)
    setExcludeUpgradesCheckedItemsParam(excludeUpgradesCheckedItems)
    setExcludeVariantsCheckedItemsParam(excludeVariantsCheckedItems)
    setConfidenceParam(confidence)
    setPityParam(pity)
    setMinFailParam(minFail)
    setIgnoreDisruptionParam(ignoreDisruption)
    setIgnoreMissingParam(ignoreMissing)
    setComponentParam(component)
    setEnvironmentParam(environment)
    setCapabilityParam(capability)

    const formattedApiCallStr = showValuesForReport()

    setIsLoaded(false)
    if (fromFile) {
      const json = require('./api_page1-big-mar2023-compNames.json')
      setData(json)
      console.log('json:', json)
      setIsLoaded(true)
    } else {
      console.log('about to fetch: ', formattedApiCallStr)
      fetch(formattedApiCallStr, { signal: abortController.signal })
        .then((response) => {
          if (response.status !== 200) {
            throw new Error('API server returned ' + response.status)
          }
          return response.json()
        })
        .then((json) => {
          console.log(json)
          if (Object.keys(json).length === 0 || json.rows.length === 0) {
            // The api call returned 200 OK but the data was empty
            setData(noDataTable)
          } else {
            setData(json)
          }
        })
        .catch((error) => {
          if (error.name === 'AbortError') {
            console.log('Request was cancelled')
            setData(cancelledDataTable)

            // Once this fired, we need a new one for the next button click.
            abortController = new AbortController()
          } else {
            setFetchError(`API call failed: ${formattedApiCallStr}\n${error}`)
          }
        })
        .finally(() => {
          // Mark the attempt as finished whether successful or not.
          setIsLoaded(true)
        })
    }
  }

  console.log('ComponentReadiness end')

  const pageTitle = makePageTitle(
    `Component Readiness for ${baseRelease} vs. ${sampleRelease}`,
    `rows: ${data && data.rows ? data.rows.length : 0}, columns: ${
      data && data.rows && data.rows[0] && data.rows[0].columns
        ? data.rows[0].columns.length
        : 0
    }`
  )

  return (
    <Fragment>
      <Route
        path={path}
        render={({ location }) => (
          <Fragment>
            <Grid
              container
              justifyContent="center"
              size="xl"
              className="cr-view"
            ></Grid>
            {/* eslint-disable react/prop-types */}
            <Switch>
              <Route
                path="/component_readiness/test"
                render={(props) => {
                  // We need to pass the testId
                  const filterVals = getUpdatedUrlParts(
                    baseRelease,
                    baseStartTime,
                    baseEndTime,
                    sampleRelease,
                    sampleStartTime,
                    sampleEndTime,
                    groupByCheckedItems,
                    excludeCloudsCheckedItems,
                    excludeArchesCheckedItems,
                    excludeNetworksCheckedItems,
                    excludeUpgradesCheckedItems,
                    excludeVariantsCheckedItems,
                    confidence,
                    pity,
                    minFail,
                    ignoreDisruption,
                    ignoreMissing
                  )
                  setComponentParam(component)
                  setCapabilityParam(capability)
                  setTestIdParam(testId)
                  return (
                    <CompReadyCapabilityTest
                      key="capabilitytest"
                      filterVals={filterVals}
                      component={component}
                      capability={capability}
                      testId={testId}
                    ></CompReadyCapabilityTest>
                  )
                }}
              />
              <Route
                path="/component_readiness/env_test"
                render={(props) => {
                  // We need to pass the environment and testId
                  const filterVals = getUpdatedUrlParts(
                    baseRelease,
                    baseStartTime,
                    baseEndTime,
                    sampleRelease,
                    sampleStartTime,
                    sampleEndTime,
                    groupByCheckedItems,
                    excludeCloudsCheckedItems,
                    excludeArchesCheckedItems,
                    excludeNetworksCheckedItems,
                    excludeUpgradesCheckedItems,
                    excludeVariantsCheckedItems,
                    confidence,
                    pity,
                    minFail,
                    ignoreDisruption,
                    ignoreMissing
                  )
                  setComponentParam(component)
                  setCapabilityParam(capability)
                  setEnvironmentParam(environment)
                  setTestIdParam(testId)
                  return (
                    <CompReadyEnvCapabilityTest
                      key="capabilitytest"
                      filterVals={filterVals}
                      component={component}
                      capability={capability}
                      testId={testId}
                      environment={environment}
                    ></CompReadyEnvCapabilityTest>
                  )
                }}
              />
              <Route
                path="/component_readiness/capability"
                render={(props) => {
                  // We need the component and capability from url
                  const filterVals = getUpdatedUrlParts(
                    baseRelease,
                    baseStartTime,
                    baseEndTime,
                    sampleRelease,
                    sampleStartTime,
                    sampleEndTime,
                    groupByCheckedItems,
                    excludeCloudsCheckedItems,
                    excludeArchesCheckedItems,
                    excludeNetworksCheckedItems,
                    excludeUpgradesCheckedItems,
                    excludeVariantsCheckedItems,
                    confidence,
                    pity,
                    minFail,
                    ignoreDisruption,
                    ignoreMissing
                  )
                  setComponentParam(component)
                  setCapabilityParam(capability)
                  return (
                    <CompReadyCapability
                      key="capabilities"
                      filterVals={filterVals}
                      component={component}
                      capability={capability}
                    ></CompReadyCapability>
                  )
                }}
              />
              <Route
                path="/component_readiness/env_capability"
                render={(props) => {
                  // We need the component and capability and environment from url
                  const filterVals = getUpdatedUrlParts(
                    baseRelease,
                    baseStartTime,
                    baseEndTime,
                    sampleRelease,
                    sampleStartTime,
                    sampleEndTime,
                    groupByCheckedItems,
                    excludeCloudsCheckedItems,
                    excludeArchesCheckedItems,
                    excludeNetworksCheckedItems,
                    excludeUpgradesCheckedItems,
                    excludeVariantsCheckedItems,
                    confidence,
                    pity,
                    minFail,
                    ignoreDisruption,
                    ignoreMissing
                  )
                  setComponentParam(component)
                  setCapabilityParam(capability)
                  setEnvironmentParam(environment)
                  return (
                    <CompReadyEnvCapability
                      key="capabilities"
                      filterVals={filterVals}
                      component={component}
                      capability={capability}
                      environment={environment}
                    ></CompReadyEnvCapability>
                  )
                }}
              />
              <Route
                path="/component_readiness/capabilities"
                render={(props) => {
                  const filterVals = getUpdatedUrlParts(
                    baseRelease,
                    baseStartTime,
                    baseEndTime,
                    sampleRelease,
                    sampleStartTime,
                    sampleEndTime,
                    groupByCheckedItems,
                    excludeCloudsCheckedItems,
                    excludeArchesCheckedItems,
                    excludeNetworksCheckedItems,
                    excludeUpgradesCheckedItems,
                    excludeVariantsCheckedItems,
                    confidence,
                    pity,
                    minFail,
                    ignoreDisruption,
                    ignoreMissing
                  )
                  setComponentParam(component)
                  return (
                    <CompReadyCapabilities
                      filterVals={filterVals}
                      component={component}
                    ></CompReadyCapabilities>
                  )
                }}
              />
              <Route
                path="/component_readiness/env_capabilities"
                render={(props) => {
                  const filterVals = getUpdatedUrlParts(
                    baseRelease,
                    baseStartTime,
                    baseEndTime,
                    sampleRelease,
                    sampleStartTime,
                    sampleEndTime,
                    groupByCheckedItems,
                    excludeCloudsCheckedItems,
                    excludeArchesCheckedItems,
                    excludeNetworksCheckedItems,
                    excludeUpgradesCheckedItems,
                    excludeVariantsCheckedItems,
                    confidence,
                    pity,
                    minFail,
                    ignoreDisruption,
                    ignoreMissing
                  )
                  setComponentParam(component)
                  setEnvironmentParam(environment)
                  // We normally would get the environment and pass it but it doesn't work
                  return (
                    <CompReadyEnvCapabilities
                      filterVals={filterVals}
                      component={component}
                      environment={environment}
                    ></CompReadyEnvCapabilities>
                  )
                }}
              />
              <Route path={path}>
                <div className="cr-view">
                  <IconButton
                    color="inherit"
                    aria-label="open drawer"
                    onClick={handleDrawerOpen}
                    edge="start"
                    className={clsx(
                      classes.menuButton,
                      drawerOpen && classes.hide
                    )}
                  >
                    <MenuIcon />
                  </IconButton>
                  <Drawer
                    className={classes.drawer}
                    variant="persistent"
                    anchor="left"
                    open={drawerOpen}
                    classes={{
                      paper: classes.drawerPaper,
                    }}
                  >
                    <div className={classes.drawerHeader}>
                      <IconButton onClick={handleDrawerClose}>
                        {theme.direction === 'ltr' ? (
                          <ChevronLeftIcon />
                        ) : (
                          <ChevronRightIcon />
                        )}
                      </IconButton>
                    </div>
                    <CompReadyMainInputs
                      baseRelease={baseRelease}
                      baseStartTime={formatLongDate(baseStartTime)}
                      baseEndTime={formatLongDate(baseEndTime)}
                      sampleRelease={sampleRelease}
                      sampleStartTime={formatLongDate(sampleStartTime)}
                      sampleEndTime={formatLongDate(sampleEndTime)}
                      groupByCheckedItems={groupByCheckedItems}
                      excludeCloudsCheckedItems={excludeCloudsCheckedItems}
                      excludeArchesCheckedItems={excludeArchesCheckedItems}
                      excludeNetworksCheckedItems={excludeNetworksCheckedItems}
                      excludeUpgradesCheckedItems={excludeUpgradesCheckedItems}
                      excludeVariantsCheckedItems={excludeVariantsCheckedItems}
                      confidence={confidence}
                      pity={pity}
                      minFail={minFail}
                      ignoreMissing={ignoreMissing}
                      ignoreDisruption={ignoreDisruption}
                      component={component}
                      environment={environment}
                      setBaseRelease={setBaseRelease}
                      setSampleRelease={setSampleRelease}
                      setBaseStartTime={setBaseStartTime}
                      setBaseEndTime={setBaseEndTime}
                      setSampleStartTime={setSampleStartTime}
                      setSampleEndTime={setSampleEndTime}
                      setGroupByCheckedItems={setGroupByCheckedItems}
                      setExcludeArchesCheckedItems={
                        setExcludeArchesCheckedItems
                      }
                      setExcludeNetworksCheckedItems={
                        setExcludeNetworksCheckedItems
                      }
                      setExcludeCloudsCheckedItems={
                        setExcludeCloudsCheckedItems
                      }
                      setExcludeUpgradesCheckedItems={
                        setExcludeUpgradesCheckedItems
                      }
                      setExcludeVariantsCheckedItems={
                        setExcludeVariantsCheckedItems
                      }
                      handleGenerateReport={handleGenerateReport}
                      handleGenerateReportDebug={handleGenerateReportDebug}
                      setConfidence={setConfidence}
                      setPity={setPity}
                      setMinFail={setMinFail}
                      setIgnoreMissing={setIgnoreMissing}
                      setIgnoreDisruption={setIgnoreDisruption}
                    ></CompReadyMainInputs>
                  </Drawer>
                  {pageTitle}
                  <TableContainer component="div" className="cr-wrapper">
                    <Table className="cr-comp-read-table">
                      <TableHead>
                        <TableRow>
                          {
                            <TableCell className={'cr-col-result-full'}>
                              <Typography className="cr-cell-name">
                                Name
                              </Typography>
                            </TableCell>
                          }
                          {columnNames.map((column, idx) => {
                            if (column !== 'Name') {
                              return (
                                <TableCell
                                  className={'cr-col-result'}
                                  key={'column' + '-' + idx}
                                >
                                  <Tooltip
                                    title={'Single row report for ' + column}
                                  >
                                    <Typography className="cr-cell-name">
                                      {column}
                                    </Typography>
                                  </Tooltip>
                                </TableCell>
                              )
                            }
                          })}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {Object.keys(data.rows).map((componentIndex) => (
                          <CompReadyRow
                            key={componentIndex}
                            componentName={data.rows[componentIndex].component}
                            results={data.rows[componentIndex].columns}
                            columnNames={columnNames}
                            filterVals={getUpdatedUrlParts(
                              baseRelease,
                              baseStartTime,
                              baseEndTime,
                              sampleRelease,
                              sampleStartTime,
                              sampleEndTime,
                              groupByCheckedItems,
                              excludeCloudsCheckedItems,
                              excludeArchesCheckedItems,
                              excludeNetworksCheckedItems,
                              excludeUpgradesCheckedItems,
                              excludeVariantsCheckedItems,
                              confidence,
                              pity,
                              minFail,
                              ignoreDisruption,
                              ignoreMissing
                            )}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </div>
              </Route>
            </Switch>
          </Fragment>
        )}
      />
    </Fragment>
  )
}
