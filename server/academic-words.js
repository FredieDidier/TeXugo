// Technical vocabulary of research writing (economics, statistics,
// epidemiology, medicine, data work) that general spelling dictionaries do
// not know. Lowercase; British and American forms both listed where they
// differ. A word here is never flagged as a spelling mistake (the page and
// the server both read this file). The user's own
// additions go to their dictionary in Preferências.
const LIST = `
quintile quintiles quartile quartiles decile deciles tercile terciles ventile ventiles percentile percentiles centile centiles
microdata macrodata metadata estimand estimands missingness logit logits probit probits tobit multinomial
binscatter binscatters binned residualized residualised residualize residualise residualizing residualising
heteroskedasticity heteroscedasticity heteroskedastic heteroscedastic homoskedastic homoscedastic homoskedasticity
covariate covariates descriptives reweighting reweighted reweight winsorized winsorised winsorize winsorise winsorizing winsorising
nonparametric semiparametric nonlinearity nonlinearities counterfactual counterfactuals subsample subsamples subsampling
pretrend pretrends placebo placebos endogeneity exogeneity overidentification overidentifying underidentification underidentified
bootstrapped bootstrapping bandwidth bandwidths stepdown workfile workfiles codebook codebooks recode recodes recoding recoded
dataset datasets geocoded geocoding geocode geocodes georeferenced gridded regressor regressors regressand autocorrelation
cointegration cointegrated shapefile shapefiles raster rasters preprocessing preprocessed preregistered preregistration
birthweight birthweights intrapartum antepartum postpartum prelabor prelabour perinatal neonatal postneonatal comorbidity comorbidities
multimorbidity cesarean cesareans caesarean caesareans gestational sociodemographic sociodemographics informality formalization formalisation
telework teleworking teleworkable teleworkability schedulable unschedulable schedulability monopsony monopsonistic oligopsony
markups nowcast nowcasting nowcasts mismeasured mismeasurement misreport misreported misreporting underreporting underreported
overdispersion overdispersed underdispersion zeroes kriging interpolations spatiotemporal sociospatial
reweights microsimulation microsimulations uptake takeup
econometric econometrics econometrician econometricians macroeconomic microeconomic microfoundations
pdf pdfs cdf cdfs
dataframe dataframes tidyverse ggplot dplyr pandas numpy stata
apgar partogram
studentized studentised partialling partialing partialled partialed covary covaries covarying medoid medoids multicountry untruncated uncoded
vape vapes vaping
`;
export const ACADEMIC_WORDS = new Set(LIST.split(/\s+/).filter(Boolean));
