/* eslint-disable import/prefer-default-export */
/* eslint-disable no-console */

const makePublic = (storage, bucket, destination) => {
  return storage
    .bucket(bucket)
    .file(destination)
    .makePublic()
    .then(() => {
      console.log(`gs://${bucket}/${destination} is now public.`);
    })
    .catch((err) => {
      console.error(`Failed to make ${destination} public...`, err);
    });
};

export const uploadFile = (
  storage,
  bucket,
  file,
  destination,
  metadata,
  gzip,
  pub
) => {
  return storage
    .bucket(bucket)
    .upload(file.path, {
      gzip,
      destination,
      metadata,
    })
    .then(() => {
      console.log(`Uploaded ${file.path} to gs://${bucket}/${destination}`);
      if (pub) {
        return makePublic(storage, bucket, destination);
      }
      return Promise.resolve();
    })
    .catch((err) => console.error(err));
};
