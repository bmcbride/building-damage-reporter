var config, map, featureList, sortOrder;
var gpsActive = false;
var params = {};

$(document).ready(function() {

  $.getJSON("config.json", function(data) {
    config = data;
    buildApp();
  });

  webshims.setOptions("forms", {
    replaceValidationUI: true,
    lazyCustomMessages: true,
    iVal: {
      sel: ".ws-validate",
      handleBubble: "hide",
      errorMessageClass: "help-block",
      errorWrapperClass: "has-error"
    },
    customDatalist: "auto",
    list: {
      "focus": true,
      "highlight": true
    }
  });

  webshims.setOptions("forms-ext", {
    replaceUI: false,
    types: "date range number",
    date: {
      startView: 2,
      openOnFocus: true
    },
    number: {
      calculateWidth: false
    },
    range: {
      classes: "show-activevaluetooltip"
    }
  });
  webshims.polyfill("forms forms-ext");
});

if (location.search) {
  var parts = location.search.substring(1).split("&");
  for (var i = 0; i < parts.length; i++) {
    var nv = parts[i].split("=");
    if (!nv[0]) continue;
    params[nv[0]] = nv[1] || true;
  }
}

function photoGallery(photos) {
  var photoArray = [];
  $.each(photos.split(","), function(index, photo) {
    photoArray.push({href: "api/uploads/" + photo});
  });
  $.fancybox(photoArray, {
    "type": "image",
    "showNavArrows": true,
    "padding": 0,
    "scrolling": "no",
    beforeShow: function () {
      this.title = "Photo " + (this.index + 1) + " of " + this.group.length + (this.title ? " - " + this.title : "");
    }
  });
  return false;
}

function buildApp() {

  if (config.sidebar.sortOrder && config.sidebar.sortOrder == "desc") {
    sortOrder = "desc";
  } else {
    sortOrder = "asc";
  }

  if (config.about.showAtStartup && config.about.showAtStartup === true) {
    $("#aboutModal").modal("show");
  }

  $(document).on("click", ".feature-row", function(e) {
    $(document).off("mouseout", ".feature-row", clearHighlight);
    sidebarClick(parseInt($(this).attr("id"), 10));
  });

  $(document).on("mouseover", ".feature-row", function(e) {
    highlight.clearLayers().addLayer(L.circleMarker([$(this).attr("lat"), $(this).attr("lng")], highlightStyle));
  });

  $(document).on("mouseout", ".feature-row", clearHighlight);

  $(document).on("click", ".new-marker-popup", function(e) {
    $("#formModal").modal("show");
  });

  $("#about-btn").click(function() {
    $("#aboutModal").modal("show");
    $(".navbar-collapse.in").collapse("hide");
    return false;
  });

  $("#full-extent-btn").click(function() {
    map.fitBounds(markerClusters.getBounds());
    $(".navbar-collapse.in").collapse("hide");
    $(".dropdown, open").removeClass("open");
    return false;
  });

  $("#refresh-btn").click(function() {
    refresh();
    $(".navbar-collapse.in").collapse("hide");
    $(".dropdown, open").removeClass("open");
    return false;
  });

  $(".search-btn").click(function() {
    $("#sidebar").toggle();
    map.invalidateSize();
    return false;
  });

  $(".new-item-btn").click(function() {
    newItem();
    return false;
  });

  $("#nav-btn").click(function() {
    $(".navbar-collapse").collapse("toggle");
    return false;
  });

  $("#sidebar-hide-btn").click(function() {
    $("#sidebar").hide();
    map.invalidateSize();
  });

  $("#cancel-btn").click(function() {
    $("#data-form")[0].reset();
    map.removeLayer(newMarker);
  });

  $("#data-form").submit(function(e) {
    e.preventDefault();
    $("<div class='modal-backdrop fade in'></div>").appendTo(document.body);
    $(".progress-bar").html("Submitting information");
    $("#loading").show();
    $("#formModal").modal("hide");
    map.removeLayer(newMarker);
    var formData = new FormData($("form#data-form")[0]);
    $("#formModal").on("hidden.bs.modal", function (e) {
      $.ajax({
        url: "api/feature",
        type: "POST",
        data: formData,
        async: false,
        success: function(data) {
          refresh(data);
          $("#data-form")[0].reset();
        },
        cache: false,
        contentType: false,
        processData: false
      });
      $("#formModal").off();
    });
    return false;
  });

  $("#comment-form").submit(function() {
    $("<div class='modal-backdrop fade in'></div>").appendTo(document.body);
    $(".progress-bar").html("Submitting information");
    $("#loading").show();
    var formData = new FormData($("#comment-form")[0]);
    $.ajax({
      url: "api/comment",
      type: "POST",
      data: formData,
      async: false,
      success: function(data) {
        fetchComments(parseInt($("input[name=feature_id]").val()));
        $("#comment-form")[0].reset();
        $("#loading").hide();
        $(".modal-backdrop").remove();
        $(".progress-bar").html("");
      },
      cache: false,
      contentType: false,
      processData: false
    });
    return false;
  });

  function newItem() {
    if (locateControl._active) {
      gpsActive = true;
    } else {
      gpsActive = false;
    }
    $("<div class='modal-backdrop fade in'></div>").appendTo(document.body);
    $("#loading").show();
    $(".progress-bar").html("Finding location...");

    function updateMarkerLocation(location) {
      newMarker.setLatLng(location).addTo(map).openPopup();
      $("#lat").val(location.lat.toFixed(6));
      $("#lng").val(location.lng.toFixed(6));
      $("#loading").hide();
      $(".modal-backdrop").remove();
      $(".progress-bar").html("");

      map.once("moveend", function(e) {
        var timeoutID;
        function stopLocate() {
          timeoutID = window.setTimeout(locateStop, 500);
        }
        function locateStop() {
          locateControl.stopLocate();
        }
        if (gpsActive === false) {
          stopLocate();
        }
      });
    }
    // If location found, use coordinates
    map.once("locationfound", function(e) {
      updateMarkerLocation(e.latlng);
    });
    // If no location found, use map center
    map.once("locationerror", function(e) {
      updateMarkerLocation(map.getCenter());
    });
    locateControl.locate();
  }

  function refresh(id) {
    if (! id) {
      $(".progress-bar").html("Loading");
      $("#loading").show();
      markers.clearLayers();
      markerClusters.clearLayers();
      $("#feature-list tbody").empty();
      url = "api/geojson";
    } else {
      url = "api/geojson/"+id;
    }
    $.ajax({
      cache: false,
      url: url,
      dataType: "json",
      success: function (data) {
        markers.addData(data);
        markerClusters.clearLayers();
        markerClusters.addLayer(markers);
      }
    }).done(function() {
      featureList = new List("features", {valueNames: ["feature-name"]});
      featureList.sort("feature-name", {order: sortOrder});
      $("#loading").hide();
      $(".modal-backdrop").remove();
      $(".progress-bar").html("");
    });
  }

  function fetchComments(id) {
    $("input[name=feature_id]").val(id);
    $.ajax({
      cache: false,
      url: "api/comments/"+id,
      dataType: "json",
      success: function (data) {
        var content = "";
        if (data.comments.length > 0) {
          $.each(data.comments, function(index, comment) {
            content += "<div class='panel panel-default'>" +
                          "<div class='panel-heading'>" +
                            "<h3 class='panel-title'>" + comment.name + "<span class='text-muted pull-right'><em>" + comment.date + "</em></span></h3>" +
                          "</div>" +
                          "<div class='panel-body'>" +
                            comment.comment +
                          "</div>" +
                        "</div>";
          });
          $("#comment-panes").html(content);
        } else {
          $("#comment-panes").html("<p class='text-muted'><em>No comments</em></p>");
        }
      }
    });
  }

  function sidebarClick(id) {
    if (config.marker.cluster && config.marker.cluster === true) {
      map.addLayer(markerClusters);
    } else {
      map.addLayer(markers);
    }
    var layer = markerClusters.getLayer(id);
    map.setView([layer.getLatLng().lat, layer.getLatLng().lng], 17);
    layer.fire("click");
    /* Hide sidebar and go to the map on small screens */
    if (document.body.clientWidth <= 767) {
      $("#sidebar").hide();
      map.invalidateSize();
    }
  }

  function clearHighlight() {
    highlight.clearLayers();
  }

  function zoomToFeature(id) {
    markerClusters.eachLayer(function (layer) {
      if (layer.feature.properties.id == id) {
        map.setView([layer.getLatLng().lat, layer.getLatLng().lng], 17);
        layer.fire("click");
      }
    });
  }

  /* Basemap Layers */
  var mapquestOSM = L.tileLayer("http://{s}.mqcdn.com/tiles/1.0.0/osm/{z}/{x}/{y}.png", {
    maxZoom: 18,
    subdomains: ["otile1", "otile2", "otile3", "otile4"],
    attribution: 'Tiles courtesy of <a href="http://www.mapquest.com/" target="_blank">MapQuest</a> <img src="http://developer.mapquest.com/content/osm/mq_logo.png">. Map data (c) <a href="http://www.openstreetmap.org/" target="_blank">OpenStreetMap</a> contributors, CC-BY-SA.'
  });
  var mapquestHYB = L.layerGroup([L.tileLayer("http://{s}.mqcdn.com/tiles/1.0.0/sat/{z}/{x}/{y}.jpg", {
    maxZoom: 18,
    subdomains: ["oatile1", "oatile2", "oatile3", "oatile4"]
  }), L.tileLayer("http://{s}.mqcdn.com/tiles/1.0.0/hyb/{z}/{x}/{y}.png", {
    maxZoom: 19,
    subdomains: ["oatile1", "oatile2", "oatile3", "oatile4"],
    attribution: "Labels courtesy of <a href='http://www.mapquest.com/' target='_blank'>MapQuest</a> <img src='http://developer.mapquest.com/content/osm/mq_logo.png'>. Map data (c) <a href='http://www.openstreetmap.org/' target='_blank'>OpenStreetMap</a> contributors, CC-BY-SA. Portions Courtesy NASA/JPL-Caltech and U.S. Depart. of Agriculture, Farm Service Agency"
  })]);
  var nysdop = L.tileLayer.wms("http://www.orthos.dhses.ny.gov/arcgis/services/Latest/MapServer/WMSServer", {
    layers: "0,1,2,3,4,5,6",
    format: "image/jpeg",
    transparent: true,
    attribution: "<a href='http://www.orthos.dhses.ny.gov/' target='_blank'>NYS Orthos Online</a>"
  });
  var nauticalCharts = L.tileLayer.wms("http://egisws02.nos.noaa.gov/ArcGIS/services/RNC/NOAA_RNC/ImageServer/WMSServer?", {
    layers: "RNC/NOAA_RNC",
    format: "image/jpeg",
    transparent: false,
    attribution: "<a href='http://specialprojects.nos.noaa.gov/tools/seamlessraster.html' target='_blank'>NOAA Charts</a>"
  });

  /* Overlay Layers */
  var highlight = L.geoJson(null);
  var highlightStyle = {
    stroke: false,
    fillColor: "#00FFFF",
    fillOpacity: 0.7,
    radius: 10
  };

  var newMarker = L.marker(null, {
    icon: L.icon({
      iconUrl: "assets/img/markers/b3b3b3.png",
      iconSize: [30, 40],
      iconAnchor: [15, 32],
      popupAnchor: [0, -35]
    }),
    draggable: true,
    riseOnHover: true
  }).bindPopup("<div class='new-marker-popup center-block'><b>Drag marker to adjust location.</b><br>Then tap here to enter info.</div>");

  newMarker.on("dragend", function(e) {
    $("#lat").val(newMarker.getLatLng().lat.toFixed(6));
    $("#lng").val(newMarker.getLatLng().lng.toFixed(6));
    newMarker.openPopup();
  });

  /* Single marker cluster layer to hold all clusters */
  var markerClusters = new L.MarkerClusterGroup({
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    disableClusteringAtZoom: 16
  });

  var markers = L.geoJson(null, {
    pointToLayer: function (feature, latlng) {
      return L.marker(latlng, {
        icon: L.icon(config.marker.icon),
        riseOnHover: true
      });
    },
    onEachFeature: function (feature, layer) {

      // If title field defined, update marker title
      if (config.marker.titleField && config.marker.titleField.length > 0) {
        layer.options.title = feature.properties[config.marker.titleField];
      }

      // If status field defined, update icons
      if (config.marker.status && config.marker.status.field && config.marker.status.field.length > 0) {
        $.each(config.marker.status.values, function(index, value) {
          if (value.name == feature.properties[config.marker.status.field]) {
            layer.setIcon(L.icon(value.icon));
          }
        });
      }

      function formatPhotos(value) {
        if (value) {
          // we only want the file names, so remove the link
          value = value.substring(value.indexOf("uploads/")+8);
          return "<a href='#' onclick='photoGallery(\"" + value + "\"); return false;'>View Photos</a>";
        } else {
          return "<i>No photos available</i>";
        }
      }
      function formatLinks(value) {
        if (value) {
          return "<a href='" + value +"' target='_blank'>" + value + "</a>";
        } else {
          return "";
        }
      }
      if (feature.properties) {
        var featureID = feature.properties.id;
        delete feature.properties.lat;
        delete feature.properties.lng;
        var content = "<table class='table table-striped table-bordered table-condensed'>";
        $.each(feature.properties, function(index, value) {
          if (index === "Photos") {
            value = formatPhotos(value);
          }
          if (index === "Link") {
            value = formatLinks(value);
          }
          if (index !== "id") {
            content += "<tr><th>" + index + "</th><td>" + value + "</td></tr>";
          }
        });
        content += "<table>";
        layer.on({
          click: function (e) {
            $("#feature-title").html(feature.properties[config.marker.titleField]);
            $("#info-tab").html(content);
            $("#feature-tabs a:first").tab("show");
            $("#featureModal").modal("show");
            fetchComments(featureID);
            $("#share-btn").click(function() {
              var link = location.protocol + '//' + location.host + location.pathname + "?id=" + featureID;
              $("#share-hyperlink").attr("href", link);
              $("#share-twitter").attr("href", "https://twitter.com/intent/tweet?url=" + link + "&text=" + config.twitter.tweet + "&via=" + config.twitter.via);
              $("#share-facebook").attr("href", "https://facebook.com/sharer.php?u=" + link);
            });
            highlight.clearLayers().addLayer(L.circleMarker([feature.geometry.coordinates[1], feature.geometry.coordinates[0]], highlightStyle));
          }
        });
        $("#feature-list tbody").append('<tr class="feature-row" id="'+L.stamp(layer)+'" lat="' + layer.getLatLng().lat + '" lng="' + layer.getLatLng().lng + '"><td style="vertical-align: middle;"><img height="20" src="'+layer.options.icon.options.iconUrl+'"></td><td class="feature-name"><em><span class="text-muted">'+layer.feature.properties.Timestamp+'</span></em><br>'+layer.feature.properties["Damage Severity"]+'</td><td style="vertical-align: middle;"><i class="fa fa-chevron-right pull-right"></i></td></tr>');
      }
    }
  });

  $.ajax({
    cache: false,
    url: "api/geojson",
    dataType: "json",
    success: function (data) {
      markers.addData(data);
      markerClusters.addLayer(markers);
      $("#loading").hide();
      featureList = new List("features", {valueNames: ["feature-name"]});
      featureList.sort("feature-name", {order: sortOrder});
      /* If id param passed in URL, zoom to feature, else fit to cluster bounds or fitWorld if no data */
      if (params.id && params.id.length > 0) {
        var id = parseInt(params.id);
        zoomToFeature(id);
      } else {
        if (markerClusters.getLayers().length === 0) {
          map.fitWorld();
        } else {
          map.fitBounds(markerClusters.getBounds(), {
            maxZoom: 17
          });
        }
      }
    }
  });

  map = L.map("map", {
    layers: [mapquestOSM, highlight],
    zoomControl: false,
    attributionControl: false
  }).fitWorld();

  if (config.marker.cluster && config.marker.cluster === true) {
    map.addLayer(markerClusters);
  } else {
    map.addLayer(markers);
  }

  /* Clear feature highlight when map is clicked */
  map.on("click", function(e) {
    highlight.clearLayers();
  });

  var zoomControl = L.control.zoom({
    position: "bottomright"
  });

  /* Larger screens get expanded layer control & zoom control*/
  if (document.body.clientWidth <= 767) {
    isCollapsed = true;
  } else {
    isCollapsed = false;
    zoomControl.addTo(map);
  }

  var baseLayers = {
    "Street Map": mapquestOSM,
    "Aerial Imagery": mapquestHYB/*,
    "NYSDOP Imagery": nysdop,
    "Nautical Charts": nauticalCharts*/
  };

  var overlayLayers = {};

  var layerControl = L.control.layers(baseLayers, null, {
    collapsed: isCollapsed
  }).addTo(map);


  if (config.marker.cluster && config.marker.cluster === true) {
    layerControl.addOverlay(markerClusters, config.marker.layer.name);
  } else {
    layerControl.addOverlay(markers, config.marker.layer.name);
  }

  /* Include basemap attribution in about modal */
  function updateAttribution(e) {
    $.each(map._layers, function(index, layer) {
      if (layer.getAttribution) {
        $("#attribution").html((layer.getAttribution()));
      }
    });
  }
  map.on("layeradd", updateAttribution);
  map.on("layerremove", updateAttribution);

  var locateControl = L.control.locate({
    position: "bottomright",
    drawCircle: true,
    follow: true,
    setView: true,
    keepCurrentZoomLevel: true,
    markerStyle: {
      weight: 1,
      opacity: 0.8,
      fillOpacity: 0.8
    },
    circleStyle: {
      weight: 1,
      clickable: false
    },
    icon: "icon-direction",
    metric: false,
    strings: {
      title: "My location",
      popup: "You are within {distance} {unit} from this point",
      outsideMapBoundsMsg: "You seem located outside the boundaries of the map"
    },
    locateOptions: {
      maxZoom: 17,
      watch: true,
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 10000
    }
  }).addTo(map);

  map.on("startfollowing", function() {
    map.on("dragstart", locateControl.stopFollowing);
  }).on("stopfollowing", function() {
    map.off("dragstart", locateControl.stopFollowing);
  });
}
