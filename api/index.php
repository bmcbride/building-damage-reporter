<?php
session_start();

require 'Slim/Slim.php';
use Slim\Slim;
\Slim\Slim::registerAutoloader();

$json = file_get_contents('../config.json');
$config = json_decode($json, true);
$dbname = 'data';
$table = $config['data']['table'];
$fields = implode(', ', $config['data']['fields']);
$titleField = $config['marker']['titleField'];
$dir = 'http://'.$_SERVER['HTTP_HOST'].dirname($_SERVER['PHP_SELF']);

# Build SQL SELECT statement including x and y columns
$sql = 'SELECT ' . $fields . ' FROM ' . $table;
$sql = str_replace('uploads', "'" . $dir . "/uploads/' || uploads", $sql);

$app = new Slim();

$app->get('/geojson', 'getFeatures');
$app->get('/geojson/:id', 'getFeature');
$app->get('/csv', 'getCSV');
$app->get('/kml', 'getKML');
$app->get('/gpx', 'getGPX');
$app->get('/comments/:id', 'getComments');
$app->post('/comment', 'newComment');
$app->post('/feature', 'newFeature');
$app->run();

function verifyFormToken($form) {
  // check if a session is started and a token is transmitted, if not return an error
  if (!isset($_SESSION[$form.'_token'])) {
    return false;
  }
  // check if the form is sent with token in it
  if (!isset($_POST['token'])) {
    return false;
  }
  // compare the tokens against each other if they are still the same
  if ($_SESSION[$form.'_token'] !== $_POST['token']) {
    return false;
  }
  return true;
}

function formatGeoJSON($sql) {
  try {
    $db = getConnection();
    $stmt = $db->prepare($sql);
    $stmt->execute();
    # Build GeoJSON feature collection array
    $geojson = array(
       'type'      => 'FeatureCollection',
       'features'  => array()
    );
    # Loop through rows to build feature arrays
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $properties = $row;
        # Remove x and y fields from properties (optional)
        unset($properties['x']);
        unset($properties['y']);
        $feature = array(
          'type' => 'Feature',
          'geometry' => array(
            'type' => 'Point',
            'coordinates' => array(
              $row['x'],
              $row['y']
            )
          ),
          'properties' => $properties
        );
        # Add feature arrays to feature collection array
        array_push($geojson['features'], $feature);
    }
    header('Access-Control-Allow-Origin: *');
    header('Content-type: application/json');
    $db = null;
    echo json_encode($geojson, JSON_NUMERIC_CHECK);
  } catch(PDOException $e) {
    echo '{"error":{"text":'. $e->getMessage() .'}}';
  }
}

function getFeatures() {
  global $sql;
  formatGeoJSON($sql);
}

function getFeature($id) {
  global $sql;
  $sql = $sql . ' WHERE id = ' . $id;
  formatGeoJSON($sql);
}

function getCSV() {
  global $sql, $table;
  try {
    $db = getConnection();
    $stmt = $db->prepare($sql);
    $stmt->execute();
    $header = array();
    $csv = fopen('php://output', 'w');
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
      if(empty($header)){ // do it only once!
        $header = array_keys($row); // get the column names
        fputcsv($csv, $header); // put them in csv
      }
      fputcsv($csv, $row);
    }
    header('Access-Control-Allow-Origin: *');
    header('Content-type: text/csv');
    //header('Content-Disposition: attachment; filename="'.$table.'.csv"');
    $db = null;
  } catch(PDOException $e) {
    echo '{"error":{"text":'. $e->getMessage() .'}}';
  }
}

function getKML() {
  global $sql, $table, $titleField;
  try {
    $db = getConnection();
    $stmt = $db->prepare($sql);
    $stmt->execute();
    # Create an array of strings to hold the lines of the KML file.
    $kml   = array(
      '<?xml version="1.0" encoding="UTF-8"?>'
    );
    $kml[] = '<kml xmlns="http://earth.google.com/kml/2.1">';
    $kml[] = '<Document>';
    $kml[] = '<Style id="generic">';
    $kml[] = '<IconStyle>';
    $kml[] = '<scale>1.3</scale>';
    $kml[] = '<Icon>';
    $kml[] = '<href>http://maps.google.com/mapfiles/kml/pushpin/red-pushpin.png</href>';
    $kml[] = '</Icon>';
    $kml[] = '<hotSpot x="20" y="2" xunits="pixels" yunits="pixels"/>';
    $kml[] = '</IconStyle>';
    $kml[] = '</Style>';

    # Loop through rows to build placemarks
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
      $data = $row;
      # Remove x and y fields from properties (optional)
      unset($data['x']);
      unset($data['y']);
      $kml[] = '<Placemark>';
      $kml[] = '<name>' . htmlentities($data[$titleField]) . '</name>';
      $kml[] = '<ExtendedData>';
      # Build extended data from fields
      foreach ($data as $key => $value) {
        $kml[] = '<Data name="' . $key . '">';
        $kml[] = '<value><![CDATA[' . $value . ']]></value>';
        $kml[] = '</Data>';
      }
      $kml[] = '</ExtendedData>';
      $kml[] = '<styleUrl>#generic</styleUrl>';
      $kml[] = '<Point>';
      $kml[] = '<coordinates>' . $row['x'] . ',' . $row['y'] . ',0</coordinates>';
      $kml[] = '</Point>';
      $kml[] = '</Placemark>';
    }

    $kml[] = '</Document>';
    $kml[] = '</kml>';
    $kmlOutput = join("\n", $kml);

    header('Content-type: application/vnd.google-earth.kml+xml kml');
    //header('Content-Disposition: attachment; filename="'.$table.'.kml"');
    //header ("Content-Type:text/xml");  // For debugging
    $db = null;
    echo $kmlOutput;
  } catch(PDOException $e) {
    echo '{"error":{"text":'. $e->getMessage() .'}}';
  }
}

function getGPX() {
  global $sql, $table, $titleField;
  try {
    $db = getConnection();
    $stmt = $db->prepare($sql);
    $stmt->execute();
    # Create an array of strings to hold the lines of the GPX file.
    $gpx = array('<?xml version="1.0" encoding="UTF-8"?>');
    $gpx[] = '<gpx version="1.1" creator="GDAL 1.9.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ogr="http://osgeo.org/gdal" xmlns="http://www.topografix.com/GPX/1/1" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">';

    # Loop through rows to build placemarks
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
      $data = $row;
      # Remove x and y fields from properties (optional)
      unset($data['x']);
      unset($data['y']);
      $gpx[] = '<wpt lat="' . $row['y'] . '" lon="' . $row['x'] . '">';
      $gpx[] = '<name>' . htmlentities($data[$titleField]) . '</name>';
      $gpx[] = '<cmt>' . htmlentities($data[$titleField]) . '</cmt>';
      $gpx[] = '</wpt>';
    }
    $gpx[] = '</gpx>';
    $gpxOutput = join("\n", $gpx);
    header('Content-type: text/xml');
    //header('Content-Disposition: attachment; filename="'.$table.'.gpx"');
    $db = null;
    echo $gpxOutput;
  } catch(PDOException $e) {
    echo '{"error":{"text":'. $e->getMessage() .'}}';
  }
}

function getComments($id) {
  $sql = "SELECT id, name, comment, date(timestamp, 'localtime') AS date FROM comments WHERE feature_id = " . $id . " ORDER BY timestamp DESC";
  try {
    $db = getConnection();
    $stmt = $db->prepare($sql);
    $stmt->execute();
    $comments = $stmt->fetchAll(PDO::FETCH_OBJ);
    echo '{"comments": ' . json_encode($comments) . '}';
    $db = null;
  } catch(PDOException $e) {
    echo '{"error":{"text":'. $e->getMessage() .'}}';
  }
}

function newComment() {
  if (verifyFormToken('form')) {
    $fields = array();
    $values = array();
    foreach ($_POST as $key => $value) {
      if ($key !== 'token') {
        $fields[] = trim($key);
        $values[] = trim($value);
      }
    }
    $sql = "INSERT INTO comments (" . implode(', ', $fields) . ") VALUES (" . ':' . implode(', :', $fields) . ");";
    try {
      $db = getConnection();
      $stmt = $db->prepare($sql);
      $stmt->execute($values);
      $db = null;
      echo "Success";
    } catch(PDOException $e) {
      echo '{"error":{"text":'. $e->getMessage() .'}}';
    }
  }
}

function newFeature() {
  global $table;
  if (verifyFormToken('form')) {
    $fields = array();
    $values = array();
    foreach ($_POST as $key => $value) {
      if ($key !== 'token') {
        if (is_array($value)) {
          $value = implode(', ', $value);
        }
        $fields[] = trim($key);
        $values[] = trim($value);
      }
    }

    $uploads = array();
    foreach ($_FILES['uploads']['error'] as $key => $error) {
      if ($error === UPLOAD_ERR_OK) {
        $filename = $_FILES['uploads']['name'][$key];
        $file_basename = substr($filename, 0, strripos($filename, '.'));
        $file_ext = substr($filename, strripos($filename, '.'));
        $newfilename = md5($file_basename) .rand() . $file_ext;
        $uploaddir = 'uploads/';
        $uploadfile = $uploaddir . $newfilename;
        move_uploaded_file($_FILES['uploads']['tmp_name'][$key], $uploadfile);
        $uploads[] = $newfilename;
      }
    }

    if (count($uploads) > 0) {
      $fields[] = 'uploads';
      $values[] = implode(',', $uploads);
    }

    $sql = "INSERT INTO $table (" . implode(', ', $fields) . ") VALUES (" . ':' . implode(', :', $fields) . ");";

    try {
      $db = getConnection();
      $stmt = $db->prepare($sql);
      $stmt->execute($values);
      echo $db->lastInsertId();
      $db = null;
    } catch(PDOException $e) {
      echo '{"error":{"text":'. $e->getMessage() .'}}';
    }
  }
}

function getConnection() {
  global $dbname;
  $dbh = new PDO('sqlite:' . $dbname . '.sqlite');
  $dbh->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  return $dbh;
}

?>
