import {
  Box,
  Card,
  CardContent,
  Grid,
  Tooltip,
  Typography,
} from '@material-ui/core'
import { CheckCircle, Error, Help, Warning } from '@material-ui/icons'
import { createTheme, makeStyles } from '@material-ui/core/styles'
import { filterFor, relativeTime } from '../helpers'
import { Link } from 'react-router-dom'
import Alert from '@material-ui/lab/Alert'
import PropTypes from 'prop-types'
import React, { useEffect } from 'react'

const defaultTheme = createTheme()
const useStyles = makeStyles(
  (theme) => ({
    releasePayloadOK: {
      backgroundColor: theme.palette.success.light,
    },
    releasePayloadProblem: {
      backgroundColor: theme.palette.error.light,
    },
  }),
  { defaultTheme }
)

function ReleasePayloadAcceptance(props) {
  const classes = useStyles()
  const theme = defaultTheme

  const [fetchError, setFetchError] = React.useState('')
  const [isLoaded, setLoaded] = React.useState(false)
  const [rows, setRows] = React.useState([])

  const fetchData = () => {
    fetch(
      process.env.REACT_APP_API_URL +
        '/api/releases/health?release=' +
        encodeURIComponent(props.release)
    )
      .then((response) => {
        if (response.status !== 200) {
          throw new Error('server returned ' + response.status)
        }
        return response.json()
      })
      .then((json) => {
        setRows(json)
        setLoaded(true)
      })
      .catch((error) => {
        setFetchError('Could not retrieve tags ' + error)
      })
  }

  useEffect(() => {
    fetchData()
  }, [])

  if (fetchError !== '') {
    return <Alert severity="error">{fetchError}</Alert>
  }

  if (isLoaded === false) {
    return <p>Loading...</p>
  }

  let cards = []
  rows.forEach((row) => {
    let bgColor = theme.palette.grey.A100
    let icon = <Help />
    let text = 'Unknown'
    let tooltip = 'No information is available.'
    if (row.releaseTime && row.releaseTime != '') {
      tooltip = `The last ${row.count} releases were ${row.lastPhase}`
      text = relativeTime(new Date(row.releaseTime))
      const when = new Date().getTime() - new Date(row.releaseTime).getTime()

      if (row.lastPhase === 'Accepted' && when <= 24 * 60 * 60 * 1000) {
        // If we had an accepted release in the last 24 hours, we're green
        bgColor = theme.palette.success.light
        icon = <CheckCircle style={{ fill: 'green' }} />
      } else if (row.lastPhase === 'Rejected') {
        // If the last payload was rejected, we are red.
        bgColor = theme.palette.error.light
        icon = <Error style={{ fill: 'maroon' }} />
      } else {
        // Otherwise we are yellow -- e.g., last release payload was accepted
        // but it's been several days.
        bgColor = theme.palette.warning.light
        icon = <Warning style={{ fill: 'goldenrod' }} />
      }
    }

    let filter = {
      items: [
        filterFor('architecture', 'equals', row.architecture),
        filterFor('stream', 'equals', row.stream),
      ],
    }

    cards.push(
      <Box
        component={Link}
        to={`/release/${props.release}/tags?filters=${encodeURIComponent(
          JSON.stringify(filter)
        )}`}
      >
        <Tooltip title={tooltip}>
          <Card
            elevation={5}
            style={{ backgroundColor: bgColor, margin: 20, width: 200 }}
          >
            <CardContent
              className={`${classes.cardContent}`}
              style={{ textAlign: 'center' }}
            >
              <Typography variant="h6">
                {row.architecture} {row.stream}
              </Typography>
              <Grid
                container
                direction="row"
                alignItems="center"
                style={{ margin: 20, textAlign: 'center' }}
              >
                {icon}&nbsp;{text}
              </Grid>
            </CardContent>
          </Card>
        </Tooltip>
      </Box>
    )
  })

  return cards
}

ReleasePayloadAcceptance.defaultProps = {}

ReleasePayloadAcceptance.propTypes = {
  release: PropTypes.string.isRequired,
}

export default ReleasePayloadAcceptance