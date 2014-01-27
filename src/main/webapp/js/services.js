/**
 * Copyright 2013 In-Q-Tel/Lab41
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

/* Services */

angular.module('dendrite.services', ['ngResource']).
    // User factory to handle authentication
    factory('User', function($rootScope, $http, $location, $cookieStore) {
      var _this = this;
      this.authenticated = false;
      this.name = null;

      var accessLevels = routingConfig.accessLevels
          , userRoles = routingConfig.userRoles
          , currentUser = $cookieStore.get('user') || { username: '', role: userRoles.ROLE_PUBLIC };

      $cookieStore.remove('user');

      function changeUser(user) {
          _.extend(currentUser, user);
      }

      function ping() {
        // Check if we're already authenticated...
        $http.get('api/user').success(function(response) {
          if (response.name === "anonymous") {
            $rootScope.$emit("event:loginRequired");
          } else {
            _this.authenticated = true;
            _this.name = response.name;
            currentUser.role = userRoles[response.authorities[0].authority];
          }
        });
      }

      ping();

      return {
        isAuthenticated: function() {
          return _this.authenticated;
        },

        getName: function() {
          return _this.name;
        },

        // login posts to spring password check and authenticates or returns empty callback
        // spring expects j_username/j_password as parameters
        login: function(username, password) {
          var payload = $.param({
            j_username: username,
            j_password: password,
            _spring_security_remember_me: "on"
          });
          var config = {
            headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'}
          };

          return $http.post($rootScope.url_login, payload, config).success(function(response) {
            ping();
          });
        },

        // logout posts to spring logout URL
        // on success, broadcast to app
        logout: function() {
          return $http.post($rootScope.url_logout, {}).
            success(function(response) {
              _this.authenticated = false;
              currentUser.role = userRoles.ROLE_PUBLIC;
              $cookieStore.remove('user');
              $rootScope.$broadcast('event:logoutConfirmed');
            });
        },

        //TODO: implement SpringMVC "ping" route to return ROLE_xxx
        getRole: function() {
          /*
          $http.get('user/roles').success(function(response) {
            currentUser.role = userRoles[response.authorities[0].authority];
          });
          */
          return currentUser.role;
        },

        // resetRole reverts current user's role to public access
        resetRole: function() {
          return currentUser.role = userRoles.ROLE_ANON;
        },

        authorize: function(accessLevel, role) {
            if(role === undefined)
                role = currentUser.role;
            if(accessLevel === undefined)
                accessLevel = userRoles.ROLE_PUBLIC;
            return accessLevel.bitMask & role.bitMask;
        },

        isLoggedIn: function(user) {
            if(user === undefined)
                user = currentUser;
            return user.role == userRoles.ROLE_USER || user.role == userRoles.ROLE_ADMIN;
        },

        accessLevels: accessLevels,
        userRoles: userRoles,
        user: currentUser
      };
    }).
    factory('Helpers', function($resource) {
        //TODO: delete once backend APIs complete - dummy result array
        var analyticResults = [];

        return {
          //TODO: delete once backend APIs complete - function to add class for progress bars
          colorProgressBars: function(progress) {
            if (progress < 0.33) {
              return 'danger';
            } else if (progress < 0.66) {
              return 'warning';
            } else if (progress < 1.0) {
              return 'info';
            } else {
              return 'success';
            }
          },
          parseGraphFile: function(text, format) {
            var keys = {};
            try {
              if (format !== "Select Format") {
                if (format === "GraphSON") {

                  // parse the graph's vertices for available keys
                  var json = JSON.parse(text);
                  Array().forEach.call(json.graph.vertices, function(v) {
                      Object.keys(v).forEach(function(key) {
                        keys[key] = true;
                      });
                  });

                }
                else if (format === "GraphML") {

                  // parse the XML and extract the graph>node>data keys
                  var xml = new DOMParser().parseFromString(text, "text/xml");
                  Array().forEach.call(xml.getElementsByTagName('node'), function(node) {
                    Array().forEach.call(node.attributes, function(attribute) {
                      keys[attribute.nodeName] = true;
                    });
                    Array().forEach.call(node.getElementsByTagName('data'), function(data) {
                      keys[data.getAttribute('key')] = true;
                    });
                  });

                }
                else if (format === "GML") {

                  // parse via regex
                  var regex_sep = ":::";
                  var regex_nodes = /node \[(.*?)\]/g
                  var regex_graph = /\[([.\s\S]*)\]/m
                  var regex_quote = /\".*?\"/g

                  // convert all whitespace to single spaces
                  var formatted = text.replace(/[\s]+/g, ' ');

                  // isolate the outermost 'graph [...]' block
                  var graph = regex_graph.exec(formatted)[1];

                  // loop through each of the 'node [...]' blocks
                  var nodes, quoted;
                  while (nodes = regex_nodes.exec(graph)) {
                    var properties_string = nodes[1];

                    // since key=val pairs are separated by spaces, first encapsulate multi-word values
                    // to eliminate space separation from disrupting key=val separation
                    // example using ':::' as multi-word separator:
                    //    input:  'key1 "v a l 1" key2 val2'
                    //    output: 'key1 "v:::a:::l:::1" key2 val2'
                    var firstIndex, condensed, properties_string_formatted = "";
                    while (quoted = regex_quote.exec(properties_string)) {
                      firstIndex = regex_quote.lastIndex - quoted[0].length;
                      condensed = quoted[0].replace(/ /g, regex_sep);
                      properties_string_formatted += properties_string.substring(0,firstIndex) + condensed;
                    }

                    // trim leading/trailing whitespace
                    properties_string_formatted = properties_string_formatted.trim();

                    // split into 'k1 v1 k2 v2' space-separated string and save list of keys
                    var properties = properties_string_formatted.split(/\s+/);
                    for (var i=0; i<properties.length; i+=2) {
                      keys[properties[i]] = true;
                    }
                  }

                }
                else if (format === "FaunusGraphSON") {

                  // read the file line-by-line, parse into JSON, and extract the keys
                  text.split('\n').forEach(function(line) {
                    if (line.length) {
                      var json = JSON.parse(line);
                      Object.keys(json).forEach(function(key) {
                        keys[key] = true;
                      });
                    }
                  });
                }
              }
            }
            catch (err) {

            }

            return Object.keys(keys);
          }
        };
    }).
    factory('ElasticSearch', function($resource, $routeParams, $http, appConfig) {
        return {

          search: function(queryParams) {
            // build elasticSearch query
            var inputJson = {
                    "from" : queryParams.pageSize*(queryParams.pageNumber - 1),
                    "size" : queryParams.pageSize,
                    "query" : { "query_string" : {"query" : "*"+queryParams.queryTerm+"*"} },
                    "filter" : { "type": { "value": queryParams.resultType } },
                    "sort" : queryParams.sortInfo
                };

            // query server
            return $http({
                method: "POST",
                url: '/dendrite/api/graphs/'+$routeParams.graphId+'/search',
                data: JSON.stringify(inputJson)
            });

          }
        };
    }).
    factory('Histogram', function($resource, $routeParams, $http, appConfig) {
      return {
        searchFacets: function(graphId) {
          return $http({
              method: "GET",
              url: '/dendrite/api/graphs/'+graphId+'/search/mapping'
          })
        },

        display: function(graphId, queryTerm, queryFacet) {
          // default inputs
          if (queryTerm === undefined || queryTerm === '') {
            queryTerm = "*";
          }

          // build elasticSearch query
          var inputJson = {
                    "size" : 0,
                    "query" : { "query_string" : {"query" : queryTerm} },
                    "facets" : {
                        "tags" : { "terms": {"field": queryFacet, "size": appConfig.elasticSearch.fieldSize}
                        }
                    }
                  };

          // query server
          return $http({
              method: "POST",
              url: '/dendrite/api/graphs/'+graphId+'/search',
              data: JSON.stringify(inputJson)
          })
          .success(function(json) {
            var facets = json.facets.tags.terms;

            // helper functions to extract properties of object array
            var getCount, getTerm;
            getCount = function(d) {
              return d.count;
            };
            getTerm = function(d) {
              return d.term;
            };

            // viz properties
            var names,scores,
                x,y,height,
                chart,
                width = $("#viz-histogram-wrapper").parent().width()*0.90,
                bar_height = 20,
                padding_width = 40,
                padding_height = 30,
                left_width = 100,
                gap = 2;

            // extract names and scores
            names = facets.map(getTerm);
            scores = facets.map(getCount);
            height = bar_height;

            // remove existing svg on refresh
            $("#viz-histogram-wrapper svg").remove();

            // add titlebar
            $('#viz-histogram-title').html('Results for facet "'+queryFacet+'" in query "' + queryTerm+'":');

            // add canvas
            chart = d3.select("#viz-histogram-wrapper")
              .append('svg')
              .attr('class', 'chart')
              .attr('width', width)
              .attr('height', height);

            // establish scales for x,y
            x = d3.scale.linear()
               .domain([0, d3.max(scores)])
               .range([0, width]);

            // redefine y for adjusting the gap
            y = d3.scale.ordinal()
              .domain(names)
              .rangeBands([0, (bar_height + 2 * gap) * names.length]);

            chart = d3.select("#viz-histogram-wrapper")
              .append('svg')
              .attr('class', 'chart')
              .attr('width', left_width + width + padding_width)
              .attr('height', (bar_height + gap * 2) * names.length + padding_height)
              .append("g")
              .attr("transform", "translate(0, 0)");

            // color bars
            chart.selectAll("rect")
              .data(facets)
              .enter().append("rect")
              .attr("x", left_width)
              .attr("y", function(d) { return y(d.term) + gap; })
              .attr("width", function(d) { return x(d.count) })
              .attr("height", bar_height);

            // display count
            chart.selectAll("text.score")
              .data(facets)
              .enter().append("text")
              .attr("x", function(d) { return x(d.count) + left_width; })
              .attr("y", function(d, i){ return y(d.term) + y.rangeBand()/2; } )
              .attr("dx", -5)
              .attr("dy", ".36em")
              .attr("text-anchor", "end")
              .attr('class', 'score')
              .text(function(d) { return d.count });

            // category label
            chart.selectAll("text.name")
              .data(facets)
              .enter().append("text")
              .attr("x", left_width / 2)
              .attr("y", function(d, i){ return y(d.term) + y.rangeBand()/2; } )
              .attr("dy", ".36em")
              .attr("text-anchor", "middle")
              .attr('class', 'name')
              .text(function(d) { return d.term });
            });
        }
      };
    }).
    factory('Scatterplot', function($resource, $routeParams, $http, appConfig) {
      return {
        searchUniqueField: function(graphId) {
          return $http({
              method: "GET",
              url: '/dendrite/api/graphs/'+graphId+'/search/mapping'
          })
        },
        searchFacets: function(graphId) {
          return $http({
              method: "GET",
              url: '/dendrite/api/graphs/'+graphId+'/search/mapping'
          })
        },

        display: function(graphId, queryFilter, querySize, queryRange, queryFacet, queryRange2, queryFacet2) {
          // default inputs
          if (queryFilter === undefined || queryFilter === '') {
            queryFilter = "*";
          }
          if (querySize === undefined || querySize === '') {
            querySize = "1000";
          }
          if (queryRange === undefined || queryRange === '') {
            queryRange = '';
          }
          if (queryRange2 === undefined || queryRange2 === '') {
            queryRange2 = '';
          }

          querySize = parseInt(querySize);
          if (querySize < 0) {
            querySize = 1000;
          }

          var queryString = queryFilter;
          if (queryRange !== '') {
            queryString += " AND " + queryFacet + ":" + queryRange;
          }
          if (queryRange2 !== '') {
            queryString += " AND " + queryFacet2 + ":" + queryRange2;
          }

          // build elasticSearch query
          var inputJson = {
                    "size" : parseInt(querySize),
                    "query" : { "query_string" : {"query" : queryString} },
                  };

          // query server
          return $http({
              method: "POST",
              url: '/dendrite/api/graphs/'+graphId+'/search',
              data: JSON.stringify(inputJson)
          })
          .success(function(json) {
            var results = json.hits.hits;

            // helper functions to extract properties of object array
            var getX = function(d) {
              if (d["_source"][queryFacet] !== undefined || d["_source"][queryFacet2] !== undefined) {
                  return ((d["_source"][queryFacet] === undefined) ? -1 : d["_source"][queryFacet]);
              } 
            };
            var getY = function(d) {
              if (d["_source"][queryFacet] !== undefined || d["_source"][queryFacet2] !== undefined) {
                  return ((d["_source"][queryFacet2] === undefined) ? -1 : d["_source"][queryFacet2]);
              } 
            };

            var chart,
                height = 400,
                width = $("#viz-scatterplot-wrapper").parent().width()*0.90;

            var randomData = function(groups, points, xval, yval) {
              var data = [],
                  shapes = ['circle', 'cross', 'triangle-up', 'triangle-down', 'diamond', 'square'],
                  random = d3.random.normal();

              for (var i = 0; i < groups; i++) {
                data.push({
                  key: 'Group ' + i,
                  values: []
                });

                for (var j = 0; j < points; j++) {
                  var x, y;
                  if (xval[j] || yval[j]) {
                    data[i].values.push({
                      x: xval[j],
                      y: yval[j],
                      size: Math.random(),
                      shape: shapes[j % 6]
                    });
                  }
                }
              }
              return data;
            };

            var xval = results.map(getX);
            var yval = results.map(getY);
            
            // remove existing svg on refresh
            $("#viz-scatterplot-wrapper svg").remove();

            // add titlebar
            $('#viz-scatterplot-title').html('Results for "'+queryString+'":');

            nv.addGraph(function() {
              chart = nv.models.scatterChart()
                            .showDistX(true)
                            .showDistY(true)
                            .useVoronoi(true)
                            .color(d3.scale.category10().range())
                            .transitionDuration(300)
                            ;

              chart.xAxis.tickFormat(d3.format('.02f'));
              chart.yAxis.tickFormat(d3.format('.02f'));
              chart.tooltipContent(function(key) {
                  return '<h2>' + key + '</h2>';
              });


              // add canvas
              chart = d3.select("#viz-scatterplot-wrapper")
                .attr('width', width)
                .attr('height', height)
                .append('svg')
                .attr('class', 'chart')
                .attr('width', width)
                .attr('height', height)
                .datum(randomData(1,querySize, xval, yval))
                .call(chart);

              nv.utils.windowResize(chart.update);

              //chart.dispatch.on('stateChange', function(e) { ('New State:', JSON.stringify(e)); });
              return chart;
            });
          });
        }
      };
    }).
    factory('Analytics', function($resource, $routeParams, $http, Project, Graph, appConfig) {
        return $resource('api/projects/:projectId/jobs', {
            projectId: '@projectId'
        }, {

          getJob: {
            url: 'api/jobs/:jobId',
            method: 'GET',
            isArray: false
          },

          deleteJob: {
            url: 'api/jobs/:jobId',
            method: 'DELETE',
            isArray: false
          },

          // fire off calculation
          createPageRankJung: {
            url: 'api/graphs/:graphId/analysis/jung-pagerank',
            method: 'POST',
            isArray: false
          },

          createGraphLab: {
            url: 'api/graphs/:graphId/analysis/:algorithm',
            method: 'POST',
            isArray: false
          },

          createBetweennessCentralityJung: {
            url: 'api/graphs/:graphId/analysis/jung-betweenness-centrality',
            method: 'POST',
            isArray: false
          },

          createEdgeDegreesFaunus: {
            url: 'api/graphs/:graphId/analysis/faunus-degrees',
            method: 'POST',
            isArray: false
          },

          createEdgeDegreesTitan: {
            url: 'api/graphs/:graphId/analysis/titan-degrees',
            method: 'POST',
            isArray: false
          }
        });
    }).
    factory('Project', function($resource) {
        return $resource('api/projects/:projectId', {
            projectId: '@projectId'
        }, {
            query: {
              method: 'GET',
              isArray: false
            },
            delete: {
              method: 'DELETE'
            },
            index: {
              url: 'api/projects',
              method: 'GET',
              isArray: false
            },
            graphs: {
              url: 'api/projects/:projectId/graphs',
              method: 'GET',
              isArray: false
            },
            create: {
              url: 'api/projects',
              method: 'POST',
              isArray: false
            },
            jobs: {
              url: 'api/projects/:projectId/jobs',
              method: 'GET'
            }
        });
    }).
    factory('Graph', function($resource) {
        return $resource('rexster-resource/graphs/:graphId', {
            graphId: '@name'
        }, {
            get: {
                url: 'api/graphs/:graphId',
                method: 'GET',
                isArray: false
            },
            query: {
                method: 'GET',
                isArray: false
            },
            index: {
              url: 'api/graphs',
              method: 'GET',
              isArray: false
            }
        });
    }).
    factory('GraphTransform', function($resource, $rootScope, $http, $q, Vertex, Edge) {
        return {
          saveFile: function(graphId, outputFormat) {
            var payload = $.param({
              format: outputFormat
            });
            var config = {
              headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'}
            };

            return $http.post('api/graphs/'+graphId+'/file-save', payload, config);
          },
          reloadGraph: function(graphId) {
            var forceDirectedGraphData = {
              vertices: $q.defer(),
              edges: $q.defer(),
            };

            Vertex.query({graphId: graphId}, function(vertices) {
              forceDirectedGraphData.vertices.resolve(vertices);
            }, function() {
              forceDirectedGraphData.vertices.reject();
            });

            Edge.query({graphId: graphId}, function(edges) {
              forceDirectedGraphData.edges.resolve(edges);
            }, function() {
              forceDirectedGraphData.edges.reject();
            });

            return forceDirectedGraphData;
          },
          reloadRandomGraph: function(graphId) {
            var forceDirectedGraphData = {
              vertices: $q.defer(),
              edges: $q.defer(),
            };

            Vertex.random({graphId: graphId}, function(response) {
              forceDirectedGraphData.vertices.resolve(response.vertices);
              forceDirectedGraphData.edges.resolve(response.edges);
            }, function() {
              forceDirectedGraphData.vertices.reject();
              forceDirectedGraphData.edges.reject();
            });

            return forceDirectedGraphData;
          }
        };
    }).
    factory('Vertex', function($resource) {
        return $resource('rexster-resource/graphs/:graphId/vertices/:vertexId', {
            graphId: '@graphId',
            vertexId: '@_id'
        }, {
            save: {
                url: 'rexster-resource/graphs/:graphId/vertices',
                method: 'POST'
            },
            show: {
                url: 'rexster-resource/graphs/:graphId/vertices/:vertexId',
                method: 'GET',
                isArray: false
            },
            update: {
                url: 'rexster-resource/graphs/:graphId/vertices/:vertexId',
                method: 'PUT'
            },
            delete: {
                url: 'rexster-resource/graphs/:graphId/vertices/:vertexId',
                method: 'DELETE'
            },
            query: {
                method: 'GET',
                isArray: false
            },
            queryConnectedVertices: {
                url: 'rexster-resource/graphs/:graphId/vertices/:vertexId/both',
                method: 'GET',
                isArray: false
            },
            queryConnectedInVertices: {
                url: 'rexster-resource/graphs/:graphId/vertices/:vertexId/in',
                method: 'GET',
                isArray: false
            },
            queryConnectedOutVertices: {
                url: 'rexster-resource/graphs/:graphId/vertices/:vertexId/out',
                method: 'GET',
                isArray: false
            },
            queryEdges: {
                url: 'rexster-resource/graphs/:graphId/vertices/:vertexId/bothE',
                method: 'GET',
                isArray: false
            },
            queryInEdges: {
                url: 'rexster-resource/graphs/:graphId/vertices/:vertexId/inE',
                method: 'GET',
                isArray: false
            },
            queryOutEdges: {
                url: 'rexster-resource/graphs/:graphId/vertices/:vertexId/outE',
                method: 'GET',
                isArray: false
            },
            list: {
                url: 'rexster-resource/graphs/:graphId/vertices',
                method: 'GET',
                isArray: false
            },
            random: {
                url: 'api/graphs/:graphId/random',
                method: 'GET',
                isArray: false
            }
        });
    }).
    factory('Edge', function($resource) {
        return $resource('rexster-resource/graphs/:graphId/edges/:edgeId', {
            graphId: '@graphId',
            edgeId: '@_id'
        }, {
            save: {
                method: 'POST'
            },
            update: {
                url: 'rexster-resource/graphs/:graphId/edges/:edgeId',
                method: 'PUT'
            },
            delete: {
                url: 'rexster-resource/graphs/:graphId/edges/:edgeId',
                method: 'DELETE'
            },
            query: {
                method: 'GET',
                isArray: false
            }
        });
    });
