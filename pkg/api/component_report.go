package api

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"cloud.google.com/go/bigquery"
	fischer "github.com/glycerine/golang-fisher-exact"
	apitype "github.com/openshift/sippy/pkg/apis/api"
	"github.com/openshift/sippy/pkg/util/sets"
	"github.com/pkg/errors"
	log "github.com/sirupsen/logrus"
	"google.golang.org/api/iterator"
)

func getSingleColumnResultToSlice(query *bigquery.Query, names *[]string) error {
	it, err := query.Read(context.TODO())
	if err != nil {
		log.WithError(err).Error("error querying test status from bigquery")
		return err
	}

	for {
		row := struct{ Name string }{}
		err := it.Next(&row)
		if err == iterator.Done {
			break
		}
		if err != nil {
			log.WithError(err).Error("error parsing component from bigquery")
			return err
		}
		*names = append(*names, row.Name)
	}
	return nil
}

var (
	cacheLock     = new(sync.RWMutex)
	cacheVariants *apitype.ComponentReportTestVariants
)

func GetComponentTestVariantsFromBigQuery(client *bigquery.Client) (apitype.ComponentReportTestVariants, []error) {
	errs := []error{}
	result := apitype.ComponentReportTestVariants{}
	cacheLock.RLock()
	if cacheVariants != nil {
		result = *cacheVariants
		cacheLock.RUnlock()
		return result, errs
	}
	cacheLock.RUnlock()
	queryString := `SELECT DISTINCT platform as name FROM ci_analysis_us.junit ORDER BY name`
	query := client.Query(queryString)
	err := getSingleColumnResultToSlice(query, &result.Platform)
	if err != nil {
		log.WithError(err).Error("error querying platforms from bigquery")
		errs = append(errs, err)
		return result, errs
	}
	queryString = `SELECT DISTINCT network as name FROM ci_analysis_us.junit ORDER BY name`
	query = client.Query(queryString)
	err = getSingleColumnResultToSlice(query, &result.Network)
	if err != nil {
		log.WithError(err).Error("error querying networks from bigquery")
		errs = append(errs, err)
		return result, errs
	}
	queryString = `SELECT DISTINCT arch as name FROM ci_analysis_us.junit ORDER BY name`
	query = client.Query(queryString)
	err = getSingleColumnResultToSlice(query, &result.Arch)
	if err != nil {
		log.WithError(err).Error("error querying arches from bigquery")
		errs = append(errs, err)
		return result, errs
	}
	queryString = `SELECT DISTINCT upgrade as name FROM ci_analysis_us.junit ORDER BY name`
	query = client.Query(queryString)
	err = getSingleColumnResultToSlice(query, &result.Upgrade)
	if err != nil {
		log.WithError(err).Error("error querying upgrades from bigquery")
		errs = append(errs, err)
		return result, errs
	}
	queryString = `SELECT DISTINCT variant as name FROM ci_analysis_us.junit, UNNEST(variants) variant`
	query = client.Query(queryString)
	err = getSingleColumnResultToSlice(query, &result.Variant)
	if err != nil {
		log.WithError(err).Error("error querying variants from bigquery")
		errs = append(errs, err)
		return result, errs
	}

	cacheLock.Lock()
	defer cacheLock.Unlock()
	cacheVariants = &apitype.ComponentReportTestVariants{}
	*cacheVariants = result

	return result, errs
}

func GetComponentReportFromBigQuery(client *bigquery.Client,
	baseRelease, sampleRelease apitype.ComponentReportRequestReleaseOptions,
	testIDOption apitype.ComponentReportRequestTestIdentificationOptions,
	variantOption apitype.ComponentReportRequestVariantOptions,
	excludeOption apitype.ComponentReportRequestExcludeOptions,
	advancedOption apitype.ComponentReportRequestAdvancedOptions) (apitype.ComponentReport, []error) {
	generator := componentReportGenerator{
		client:        client,
		baseRelease:   baseRelease,
		sampleRelease: sampleRelease,
		ComponentReportRequestTestIdentificationOptions: testIDOption,
		ComponentReportRequestVariantOptions:            variantOption,
		ComponentReportRequestExcludeOptions:            excludeOption,
		ComponentReportRequestAdvancedOptions:           advancedOption,
	}
	return generator.GenerateReport()
}

type componentReportGenerator struct {
	client        *bigquery.Client
	baseRelease   apitype.ComponentReportRequestReleaseOptions
	sampleRelease apitype.ComponentReportRequestReleaseOptions
	apitype.ComponentReportRequestTestIdentificationOptions
	apitype.ComponentReportRequestVariantOptions
	apitype.ComponentReportRequestExcludeOptions
	apitype.ComponentReportRequestAdvancedOptions
	schema bigquery.Schema
}

func (c *componentReportGenerator) GenerateReport() (apitype.ComponentReport, []error) {
	before := time.Now()
	baseStatus, sampleStatus, errs := c.getTestStatusFromBigQuery()
	if len(errs) > 0 {
		return apitype.ComponentReport{}, errs
	}
	fmt.Printf("----- total query took %+v\n", time.Since(before))
	var report apitype.ComponentReport
	if c.TestID != "" &&
		c.Platform != "" &&
		c.Network != "" &&
		c.Upgrade != "" &&
		c.Arch != "" &&
		c.Variant != "" {
		// TODO
		// This request is for a particular test details
		_ = c.generateComponentTestReport(baseStatus, sampleStatus)
	} else {
		before = time.Now()
		report = c.generateComponentTestReport(baseStatus, sampleStatus)
		fmt.Printf("----- generate report took %+v\n", time.Since(before))
	}
	return report, nil
}

// fetchQuerySchema is used to get the schema of the query we are going to use
// to fetch base and sample status
// But this seems to be adding 3s query time
func (c *componentReportGenerator) fetchQuerySchema(queryString string) {
	queryString += `LIMIT 1`
	query := c.client.Query(queryString)
	it, err := query.Read(context.TODO())
	if err != nil {
		log.WithError(err).Error("error querying test status from bigquery")
		return
	}

	for {
		testStatus := apitype.ComponentTestStatus{}
		err := it.Next(&testStatus)
		if err == iterator.Done {
			break
		}
		if err != nil {
			log.WithError(err).Error("error parsing component from bigquery")
			continue
		}

		c.schema = it.Schema
		break
	}
}

func (c *componentReportGenerator) getTestStatusFromBigQuery() (
	map[apitype.ComponentTestIdentification]apitype.ComponentTestStats,
	map[apitype.ComponentTestIdentification]apitype.ComponentTestStats,
	[]error,
) {
	errs := []error{}
	queryString := `WITH latest_component_mapping AS (
    					SELECT *
    					FROM ci_analysis_us.component_mapping cm
    					WHERE created_at = (
								SELECT MAX(created_at)
								FROM openshift-gce-devel.ci_analysis_us.component_mapping))
					SELECT
						ANY_VALUE(test_name) AS test_name,
						test_id,
						network,
						upgrade,
						arch,
						platform,
						ANY_VALUE(flat_variants) AS variant,
						COUNT(test_id) AS total_count,
						SUM(success_val) AS success_count,
						SUM(flake_count) AS flake_count,
						ANY_VALUE(cm.component) AS component,
						ANY_VALUE(cm.capabilities) AS capabilities
					FROM ci_analysis_us.junit
						INNER JOIN latest_component_mapping cm ON testsuite = cm.suite
							AND test_name = cm.name `

	groupString := `
					GROUP BY
						network,
						upgrade,
						arch,
						platform,
						test_id `

	if c.schema == nil {
		b := time.Now()
		c.fetchQuerySchema(queryString + groupString)
		fmt.Printf("----- schema query took %+v\n", time.Since(b))
	}
	queryString += `WHERE TIMESTAMP(modified_time) >= @From AND TIMESTAMP(modified_time) < @To `
	commonParams := []bigquery.QueryParameter{}
	if c.Upgrade != "" {
		queryString += ` AND upgrade = @Upgrade`
		commonParams = append(commonParams, bigquery.QueryParameter{
			Name:  "Upgrade",
			Value: c.Upgrade,
		})
	}
	if c.Arch != "" {
		queryString += ` AND arch = @Arch`
		commonParams = append(commonParams, bigquery.QueryParameter{
			Name:  "Arch",
			Value: c.Arch,
		})
	}
	if c.Network != "" {
		queryString += ` AND network = @Network`
		commonParams = append(commonParams, bigquery.QueryParameter{
			Name:  "Network",
			Value: c.Network,
		})
	}
	if c.Platform != "" {
		queryString += ` AND platform = @Platform`
		commonParams = append(commonParams, bigquery.QueryParameter{
			Name:  "Platform",
			Value: c.Platform,
		})
	}
	if c.TestID != "" {
		queryString += ` AND test_id = @TestId`
		commonParams = append(commonParams, bigquery.QueryParameter{
			Name:  "TestId",
			Value: c.TestID,
		})
	}

	if c.ExcludePlatforms != "" {
		queryString += ` AND platform NOT IN UNNEST(@ExcludePlatforms)`
		commonParams = append(commonParams, bigquery.QueryParameter{
			Name:  "ExcludePlatforms",
			Value: strings.Split(c.ExcludePlatforms, ","),
		})
	}
	if c.ExcludeArches != "" {
		queryString += ` AND arch NOT IN UNNEST(@ExcludeArches)`
		commonParams = append(commonParams, bigquery.QueryParameter{
			Name:  "ExcludeArches",
			Value: strings.Split(c.ExcludeArches, ","),
		})
	}
	if c.ExcludeNetworks != "" {
		queryString += ` AND network NOT IN UNNEST(@ExcludeNetworks)`
		commonParams = append(commonParams, bigquery.QueryParameter{
			Name:  "ExcludeNetworks",
			Value: strings.Split(c.ExcludeNetworks, ","),
		})
	}
	if c.ExcludeUpgrades != "" {
		queryString += ` AND upgrade NOT IN UNNEST(@ExcludeUpgrades)`
		commonParams = append(commonParams, bigquery.QueryParameter{
			Name:  "ExcludeUpgrades",
			Value: strings.Split(c.ExcludeUpgrades, ","),
		})
	}
	if c.ExcludeVariants != "" {
		queryString += ` AND variant NOT IN UNNEST(@ExcludeVariants)`
		commonParams = append(commonParams, bigquery.QueryParameter{
			Name:  "ExcludeVariants",
			Value: strings.Split(c.ExcludeVariants, ","),
		})
	}

	baseString := queryString + ` AND branch = @BaseRelease`
	baseQuery := c.client.Query(baseString + groupString)
	baseQuery.Parameters = append(commonParams, []bigquery.QueryParameter{
		{
			Name:  "From",
			Value: c.baseRelease.Start,
		},
		{
			Name:  "To",
			Value: c.baseRelease.End,
		},
		{
			Name:  "BaseRelease",
			Value: c.baseRelease.Release,
		},
	}...)

	var baseStatus, sampleStatus map[apitype.ComponentTestIdentification]apitype.ComponentTestStats
	var baseErrs, sampleErrs []error
	wg := sync.WaitGroup{}
	wg.Add(1)
	go func() {
		defer wg.Done()
		before := time.Now()
		baseStatus, baseErrs = c.fetchTestStatus(baseQuery)
		fmt.Printf("----- base query took %+v\n", time.Since(before))
	}()

	sampleString := queryString + ` AND branch = @SampleRelease`
	sampleQuery := c.client.Query(sampleString + groupString)
	sampleQuery.Parameters = append(commonParams, []bigquery.QueryParameter{
		{
			Name:  "From",
			Value: c.sampleRelease.Start,
		},
		{
			Name:  "To",
			Value: c.sampleRelease.End,
		},
		{
			Name:  "SampleRelease",
			Value: c.sampleRelease.Release,
		},
	}...)
	wg.Add(1)
	go func() {
		defer wg.Done()
		before := time.Now()
		sampleStatus, sampleErrs = c.fetchTestStatus(sampleQuery)
		fmt.Printf("----- sample query took %+v\n", time.Since(before))
	}()
	wg.Wait()
	if len(baseErrs) != 0 || len(sampleErrs) != 0 {
		errs = append(errs, baseErrs...)
		errs = append(errs, sampleErrs...)
	}
	return baseStatus, sampleStatus, errs
}

var componentAndCapabilityGetter func(test apitype.ComponentTestIdentification, stats apitype.ComponentTestStats) (string, []string)

/*
func testToComponentAndCapabilityUseRegex(test *apitype.ComponentTestIdentification, stats *apitype.ComponentTestStats) (string, []string) {
	name := test.TestName
	component := "other_component"
	capability := "other_capability"
	r := regexp.MustCompile(`.*(?P<component>\[sig-[A-Za-z]*\]).*(?P<feature>\[Feature:[A-Za-z]*\]).*`)
	subMatches := r.FindStringSubmatch(name)
	if len(subMatches) >= 2 {
		subNames := r.SubexpNames()
		for i, sName := range subNames {
			switch sName {
			case "component":
				component = subMatches[i]
			case "feature":
				capability = subMatches[i]
			}
		}
	}
	return component, []string{capability}
}*/

func testToComponentAndCapability(test apitype.ComponentTestIdentification, stats apitype.ComponentTestStats) (string, []string) {
	return stats.Component, stats.Capabilities
}

// getRowColumnIdentifications defines the rows and columns since they are variable. For rows, different pages have different row titles (component, capability etc)
// Columns titles depends on the groupBy parameter user requests. A particular test can belong to multiple rows of different capabilities.
func (c *componentReportGenerator) getRowColumnIdentifications(test apitype.ComponentTestIdentification, stats apitype.ComponentTestStats) ([]apitype.ComponentReportRowIdentification, apitype.ComponentReportColumnIdentification) {
	component, capabilities := componentAndCapabilityGetter(test, stats)
	rows := []apitype.ComponentReportRowIdentification{}
	// First Page with no component requested
	if c.Component == "" {
		rows = append(rows, apitype.ComponentReportRowIdentification{Component: component})
	} else if c.Component == component {
		// Exact test match
		if c.TestID != "" {
			row := apitype.ComponentReportRowIdentification{
				Component: component,
				TestID:    test.TestID,
				TestName:  test.TestName,
			}
			if c.Capability != "" {
				row.Capability = c.Capability
			}
			rows = append(rows, row)
		} else {
			for _, capability := range capabilities {
				// Exact capability match only produces one row
				if c.Capability != "" {
					if c.Capability == capability {
						row := apitype.ComponentReportRowIdentification{
							Component:  component,
							TestID:     test.TestID,
							TestName:   test.TestName,
							Capability: capability,
						}
						rows = append(rows, row)
						break
					}
				} else {
					rows = append(rows, apitype.ComponentReportRowIdentification{Component: component, Capability: capability})
				}
			}
		}
	}
	column := apitype.ComponentReportColumnIdentification{}
	groups := sets.NewString(strings.Split(c.GroupBy, ",")...)
	if c.TestID != "" {
		// When testID is specified, ignore groupBy to disambiguate the test
		column.Platform = test.Platform
		column.Network = test.Network
		column.Arch = test.Arch
		column.Upgrade = test.Upgrade
		column.Variant = test.Variant
	} else {
		if groups.Has("cloud") {
			column.Platform = test.Platform
		}
		if groups.Has("network") {
			column.Network = test.Network
		}
		if groups.Has("arch") {
			column.Arch = test.Arch
		}
		if groups.Has("upgrade") {
			column.Upgrade = test.Upgrade
		}
		if groups.Has("variant") {
			column.Variant = test.Variant
		}
	}

	return rows, column
}

func (c *componentReportGenerator) fetchTestStatus(query *bigquery.Query) (map[apitype.ComponentTestIdentification]apitype.ComponentTestStats, []error) {
	errs := []error{}
	status := map[apitype.ComponentTestIdentification]apitype.ComponentTestStats{}

	it, err := query.Read(context.TODO())
	if err != nil {
		log.WithError(err).Error("error querying test status from bigquery")
		errs = append(errs, err)
		return status, errs
	}

	for {
		testStatus := apitype.ComponentTestStatus{}
		if it.Schema == nil {
			// There seems to be a bug with bigquery storage API
			// Without this schema, data is not marshalled properly into
			// ComponentTestStatus
			// We work around this by running one query and get
			// the schema set. Our last resort is to infer the schema
			// from the structure.
			it.Schema = c.schema
			if it.Schema == nil {
				schema, err := bigquery.InferSchema(testStatus)
				if err != nil {
					log.WithError(err).Error("error inferring schema")
					errs = append(errs, errors.Wrap(err, "error inferring schema"))
				} else {
					it.Schema = schema
				}
			}
		}
		err := it.Next(&testStatus)
		if err == iterator.Done {
			break
		}
		if err != nil {
			log.WithError(err).Error("error parsing component from bigquery")
			errs = append(errs, errors.Wrap(err, "error parsing prowjob from bigquery"))
			continue
		}
		testIdentification := apitype.ComponentTestIdentification{
			TestName: testStatus.TestName,
			TestID:   testStatus.TestID,
			Network:  testStatus.Network,
			Upgrade:  testStatus.Upgrade,
			Arch:     testStatus.Arch,
			Platform: testStatus.Platform,
			Variant:  testStatus.Variant,
		}
		status[testIdentification] = apitype.ComponentTestStats{
			Component:    testStatus.Component,
			Capabilities: testStatus.Capabilities,
			TotalCount:   testStatus.TotalCount,
			FlakeCount:   testStatus.FlakeCount,
			SuccessCount: testStatus.SuccessCount,
		}
	}
	return status, errs
}

func updateStatus(rowIdentifications []apitype.ComponentReportRowIdentification,
	columnIdentification apitype.ComponentReportColumnIdentification,
	reportStatus apitype.ComponentReportStatus,
	status map[apitype.ComponentReportRowIdentification]map[apitype.ComponentReportColumnIdentification]apitype.ComponentReportStatus,
	allRows map[apitype.ComponentReportRowIdentification]struct{},
	allColumns map[apitype.ComponentReportColumnIdentification]struct{}) {
	if _, ok := allColumns[columnIdentification]; !ok {
		allColumns[columnIdentification] = struct{}{}
	}
	for _, rowIdentification := range rowIdentifications {
		if _, ok := allRows[rowIdentification]; !ok {
			allRows[rowIdentification] = struct{}{}
		}
		row, ok := status[rowIdentification]
		if !ok {
			row = map[apitype.ComponentReportColumnIdentification]apitype.ComponentReportStatus{}
			row[columnIdentification] = reportStatus
			status[rowIdentification] = row
		} else {
			existing, ok := row[columnIdentification]
			if !ok {
				row[columnIdentification] = reportStatus
			} else if (reportStatus < apitype.NotSignificant && reportStatus < existing) ||
				(existing == apitype.NotSignificant && reportStatus == apitype.SignificantImprovement) {
				// We want to show the significant improvement if assessment is not regression
				row[columnIdentification] = reportStatus
			}
		}
	}
}

func (c *componentReportGenerator) generateComponentTestReport(baseStatus map[apitype.ComponentTestIdentification]apitype.ComponentTestStats,
	sampleStatus map[apitype.ComponentTestIdentification]apitype.ComponentTestStats) apitype.ComponentReport {
	report := apitype.ComponentReport{}
	// aggregatedStatus is the aggregated status based on the requested rows and columns
	aggregatedStatus := map[apitype.ComponentReportRowIdentification]map[apitype.ComponentReportColumnIdentification]apitype.ComponentReportStatus{}
	// allRows and allColumns are used to make sure rows are ordered and all rows have the same columns in the same order
	allRows := map[apitype.ComponentReportRowIdentification]struct{}{}
	allColumns := map[apitype.ComponentReportColumnIdentification]struct{}{}
	for testIdentification, baseStats := range baseStatus {
		var reportStatus apitype.ComponentReportStatus
		sampleStats, ok := sampleStatus[testIdentification]
		if !ok {
			reportStatus = apitype.MissingSample
		} else {
			reportStatus = c.categorizeComponentStatus(sampleStats, baseStats)
		}
		delete(sampleStatus, testIdentification)

		rowIdentifications, columnIdentification := c.getRowColumnIdentifications(testIdentification, baseStats)
		updateStatus(rowIdentifications, columnIdentification, reportStatus, aggregatedStatus, allRows, allColumns)
	}
	// Those sample ones are missing base stats
	for testIdentification, sampleStats := range sampleStatus {
		rowIdentifications, columnIdentification := c.getRowColumnIdentifications(testIdentification, sampleStats)
		updateStatus(rowIdentifications, columnIdentification, apitype.MissingBasis, aggregatedStatus, allRows, allColumns)
	}
	// Sort the row identifications
	sortedRows := []apitype.ComponentReportRowIdentification{}
	for rowID := range allRows {
		sortedRows = append(sortedRows, rowID)
	}
	sort.Slice(sortedRows, func(i, j int) bool {
		return sortedRows[i].Component < sortedRows[j].Component ||
			sortedRows[i].Capability < sortedRows[j].Capability ||
			sortedRows[i].TestName < sortedRows[j].TestName ||
			sortedRows[i].TestID < sortedRows[j].TestID
	})

	// Sort the column identifications
	sortedColumns := []apitype.ComponentReportColumnIdentification{}
	for columnID := range allColumns {
		sortedColumns = append(sortedColumns, columnID)
	}
	sort.Slice(sortedColumns, func(i, j int) bool {
		return sortedColumns[i].Platform < sortedColumns[j].Platform ||
			sortedColumns[i].Arch < sortedColumns[j].Arch ||
			sortedColumns[i].Network < sortedColumns[j].Network ||
			sortedColumns[i].Upgrade < sortedColumns[j].Upgrade ||
			sortedColumns[i].Variant < sortedColumns[j].Variant
	})

	// Now build the report
	for _, rowID := range sortedRows {
		if columns, ok := aggregatedStatus[rowID]; ok {
			if report.Rows == nil {
				report.Rows = []apitype.ComponentReportRow{}
			}
			reportRow := apitype.ComponentReportRow{ComponentReportRowIdentification: rowID}
			for _, columnID := range sortedColumns {
				if reportRow.Columns == nil {
					reportRow.Columns = []apitype.ComponentReportColumn{}
				}
				reportColumn := apitype.ComponentReportColumn{ComponentReportColumnIdentification: columnID}
				status, ok := columns[columnID]
				if !ok {
					reportColumn.Status = apitype.MissingBasisAndSample
				} else {
					reportColumn.Status = status
				}
				reportRow.Columns = append(reportRow.Columns, reportColumn)
			}
			report.Rows = append(report.Rows, reportRow)
		}
	}

	return report
}

func (c *componentReportGenerator) categorizeComponentStatus(sampleStats, baseStats apitype.ComponentTestStats) apitype.ComponentReportStatus {
	ret := apitype.MissingBasis
	if baseStats.TotalCount != 0 {
		if sampleStats.TotalCount == 0 {
			if c.IgnoreMissing {
				ret = apitype.NotSignificant

			} else {
				ret = apitype.MissingSample
			}
		} else {
			if c.MinimumFailure != 0 && (sampleStats.TotalCount-sampleStats.SuccessCount-sampleStats.FlakeCount) < c.MinimumFailure {
				return apitype.NotSignificant
			}
			basisPassPercentage := float64(baseStats.SuccessCount+baseStats.FlakeCount) / float64(baseStats.TotalCount)
			samplePassPercentage := float64(sampleStats.SuccessCount+sampleStats.FlakeCount) / float64(sampleStats.TotalCount)
			significant := false
			improved := samplePassPercentage >= basisPassPercentage
			if improved {
				_, _, r, _ := fischer.FisherExactTest(baseStats.TotalCount-baseStats.SuccessCount-baseStats.FlakeCount,
					baseStats.SuccessCount+baseStats.FlakeCount,
					sampleStats.TotalCount-sampleStats.SuccessCount-sampleStats.FlakeCount,
					sampleStats.SuccessCount+sampleStats.FlakeCount)
				significant = r < 1-float64(c.Confidence)/100
			} else if basisPassPercentage-samplePassPercentage > float64(c.PityFactor)/100 {
				_, _, r, _ := fischer.FisherExactTest(sampleStats.TotalCount-sampleStats.SuccessCount-sampleStats.FlakeCount,
					sampleStats.SuccessCount+sampleStats.FlakeCount,
					baseStats.TotalCount-baseStats.SuccessCount-baseStats.FlakeCount,
					baseStats.SuccessCount+baseStats.FlakeCount)
				significant = r < 1-float64(c.Confidence)/100
			}
			if significant {
				if improved {
					ret = apitype.SignificantImprovement
				} else {
					if (basisPassPercentage - samplePassPercentage) > 0.15 {
						ret = apitype.ExtremeRegression
					} else {
						ret = apitype.SignificantRegression
					}
				}
			} else {
				ret = apitype.NotSignificant
			}
		}
	}
	return ret
}

func init() {
	componentAndCapabilityGetter = testToComponentAndCapability
}
